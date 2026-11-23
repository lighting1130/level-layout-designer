// Level Layout Importer - MIT License

#include "LayoutSceneBuilder.h"

#include "LevelLayoutImporterSettings.h"
#include "LevelLayoutLog.h"

#include "ActorFactories/ActorFactory.h"
#include "Algo/Reverse.h"
#include "AssetToolsModule.h"
#include "Builders/CubeBuilder.h"
#include "Camera/CameraActor.h"
#include "Components/StaticMeshComponent.h"
#include "Components/TextRenderComponent.h"
#include "Engine/Font.h"
#include "Engine/FontImportOptions.h"
#include "Engine/StaticMesh.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/TextRenderActor.h"
#include "Engine/Texture2D.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "Factories/MaterialInstanceConstantFactoryNew.h"
#include "Factories/TrueTypeFontFactory.h"
#include "FileHelpers.h"
#include "GameFramework/PlayerStart.h"
#include "HAL/PlatformMisc.h"
#include "Materials/MaterialInstanceConstant.h"
#include "Misc/Crc.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "Misc/ScopedSlowTask.h"
#include "NavMesh/NavMeshBoundsVolume.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "GameFramework/PainCausingVolume.h"
#include "GameFramework/PhysicsVolume.h"
#include "MeshDescription.h"
#include "PhysicsEngine/BodySetup.h"
#include "StaticMeshAttributes.h"
#include "UObject/Package.h"
#include "UObject/UnrealType.h"

#define LOCTEXT_NAMESPACE "LevelLayoutImporter"

namespace LevelLayout
{
	const FName ImportedTag(TEXT("LevelLayout"));

	static const TCHAR* CubePath = TEXT("/Engine/BasicShapes/Cube.Cube"); // 100 cm, centered
	static const TCHAR* CylinderPath = TEXT("/Engine/BasicShapes/Cylinder.Cylinder");
	static const TCHAR* BaseMaterialPath = TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"); // has a "Color" parameter
	static constexpr int32 FontHeight = 64;

	// Windows system fonts with CJK glyphs: (font name for TrueTypeFontFactory, file in Windows\Fonts).
	static const TCHAR* CjkFonts[][2] = {
		{TEXT("Microsoft YaHei"), TEXT("msyh.ttc")},
		{TEXT("SimHei"), TEXT("simhei.ttf")},
		{TEXT("DengXian"), TEXT("Deng.ttf")},
		{TEXT("SimSun"), TEXT("simsun.ttc")},
	};

	FString SafeName(const FString& InName)
	{
		FString Out;
		bool bLastUnderscore = false;
		for (const TCHAR C : InName)
		{
			const bool bOk = (C < 128 && FChar::IsAlnum(C)) || C == TEXT('_') || (C >= 0x4E00 && C <= 0x9FFF);
			if (bOk)
			{
				Out.AppendChar(C);
				bLastUnderscore = C == TEXT('_');
			}
			else if (!bLastUnderscore)
			{
				Out.AppendChar(TEXT('_'));
				bLastUnderscore = true;
			}
		}
		Out.TrimCharInline(TEXT('_'), nullptr);
		Out.LeftInline(60);
		return Out.IsEmpty() ? FString(TEXT("Untitled")) : Out;
	}

	FName ProjectTag(const FString& SafeProjectName)
	{
		return FName(*(TEXT("LevelLayout:") + SafeProjectName));
	}

	int32 RemoveActorsWithTag(UWorld* World, FName InTag)
	{
		if (!World)
		{
			return 0;
		}
		const FName Wanted = InTag.IsNone() ? ImportedTag : InTag;
		TArray<AActor*> Old;
		for (TActorIterator<AActor> It(World); It; ++It)
		{
			if (It->Tags.Contains(Wanted))
			{
				Old.Add(*It);
			}
		}
		for (AActor* A : Old)
		{
			World->EditorDestroyActor(A, true);
		}
		return Old.Num();
	}

	static FLinearColor HexToLinear(const FString& Hex)
	{
		return FLinearColor(FColor::FromHex(Hex)); // sRGB -> linear
	}

	// ---------- Reflection helpers for Blockout Tools (soft reference only, no headers) ----------

	static FProperty* FindProp(UObject* Obj, const TCHAR* Name)
	{
		return Obj ? Obj->GetClass()->FindPropertyByName(FName(Name)) : nullptr;
	}

	static bool SetBoolProp(UObject* Obj, const TCHAR* Name, bool bValue)
	{
		if (FBoolProperty* P = CastField<FBoolProperty>(FindProp(Obj, Name)))
		{
			P->SetPropertyValue_InContainer(Obj, bValue);
			return true;
		}
		return false;
	}

	static bool SetNumberProp(UObject* Obj, const TCHAR* Name, double Value)
	{
		if (FNumericProperty* P = CastField<FNumericProperty>(FindProp(Obj, Name)))
		{
			void* Ptr = P->ContainerPtrToValuePtr<void>(Obj);
			if (P->IsFloatingPoint())
			{
				P->SetFloatingPointPropertyValue(Ptr, Value);
			}
			else
			{
				P->SetIntPropertyValue(Ptr, (int64)FMath::RoundToDouble(Value));
			}
			return true;
		}
		return false;
	}

	template <typename T>
	static bool SetStructProp(UObject* Obj, const TCHAR* Name, const T& Value)
	{
		FStructProperty* P = CastField<FStructProperty>(FindProp(Obj, Name));
		if (P && P->Struct == TBaseStructure<T>::Get())
		{
			*P->ContainerPtrToValuePtr<T>(Obj) = Value;
			return true;
		}
		return false;
	}

	static bool SetNameProp(UObject* Obj, const TCHAR* Name, FName Value)
	{
		FProperty* P = FindProp(Obj, Name);
		if (FNameProperty* NP = CastField<FNameProperty>(P))
		{
			NP->SetPropertyValue_InContainer(Obj, Value);
			return true;
		}
		if (FStrProperty* SP = CastField<FStrProperty>(P))
		{
			SP->SetPropertyValue_InContainer(Obj, Value.ToString());
			return true;
		}
		return false;
	}

	static bool MeshBounds(AActor* Actor, FBox& Out)
	{
		Out = FBox(ForceInit);
		TArray<UStaticMeshComponent*> Comps;
		Actor->GetComponents(Comps);
		for (UStaticMeshComponent* C : Comps)
		{
			if (C && C->GetStaticMesh())
			{
				// Only the mesh: the blueprint also has an editor icon component (about 256 cm) that would skew actor bounds.
				Out += C->CalcBounds(C->GetComponentTransform()).GetBox();
			}
		}
		return Out.IsValid != 0;
	}

	// ---------- Builder ----------

	FSceneBuilder::FSceneBuilder(UWorld* InWorld, const FPlan& InPlan, const FLevelLayoutImportOptions& InOptions, FLevelLayoutImportResult& InResult)
		: World(InWorld), Plan(InPlan), Options(InOptions), Result(InResult)
	{
		Name = SafeName(Plan.Name);
		Tag = ProjectTag(Name);
	}

	FString FSceneBuilder::AssetFolder() const
	{
		FString Root = Options.AssetFolder.IsEmpty() ? FString(TEXT("/Game/LevelLayout")) : Options.AssetFolder;
		while (Root.EndsWith(TEXT("/")))
		{
			Root.LeftChopInline(1);
		}
		return Root / Name;
	}

	bool FSceneBuilder::Run()
	{
		Cube = LoadObject<UStaticMesh>(nullptr, CubePath);
		Cylinder = LoadObject<UStaticMesh>(nullptr, CylinderPath);
		if (!Cube || !Cylinder)
		{
			Result.Error = TEXT("Engine basic shapes (/Engine/BasicShapes) are missing.");
			return false;
		}
		if (!SetupBackend())
		{
			return false;
		}
		Font = ResolveFont();

		if (Options.bReplacePrevious)
		{
			Result.NumRemoved = RemoveActorsWithTag(World, Tag);
		}

		const int32 Total = Plan.Boxes.Num() + Plan.Meshes.Num() + Plan.Volumes.Num() + Plan.Markers.Num() + Plan.Notes.Num();
		FScopedSlowTask Task((float)FMath::Max(Total, 1), FText::Format(LOCTEXT("Building", "Building blockout: {0}"), FText::FromString(Plan.Name)));
		Task.MakeDialog(true);
		for (int32 N = 0; N < Plan.Boxes.Num(); ++N)
		{
			if (Task.ShouldCancel())
			{
				Result.Warnings.Add(TEXT("Canceled: the blockout is incomplete. Undo (Ctrl+Z) removes it."));
				break;
			}
			Task.EnterProgressFrame(1);
			if (SpawnBox(Plan.Boxes[N], N))
			{
				++Result.NumBoxes;
			}
		}
		for (int32 N = 0; N < Plan.Meshes.Num() && !Task.ShouldCancel(); ++N)
		{
			Task.EnterProgressFrame(1);
			if (SpawnMesh(Plan.Meshes[N], N))
			{
				++Result.NumMeshes;
			}
		}
		for (int32 N = 0; Options.bAddVolumes && N < Plan.Volumes.Num() && !Task.ShouldCancel(); ++N)
		{
			Task.EnterProgressFrame(1);
			if (SpawnVolume(Plan.Volumes[N], N))
			{
				++Result.NumVolumes;
			}
		}
		for (int32 N = 0; N < Plan.Markers.Num() && !Task.ShouldCancel(); ++N)
		{
			Task.EnterProgressFrame(1);
			if (SpawnMarker(Plan.Markers[N], N))
			{
				++Result.NumMarkers;
			}
		}
		for (int32 N = 0; N < Plan.Notes.Num() && !Task.ShouldCancel(); ++N)
		{
			Task.EnterProgressFrame(1);
			const FNoteItem& Note = Plan.Notes[N];
			if (SpawnText(Note.Text, Note.Level, Note.Location, FString::Printf(TEXT("Note_%03d"), N), 60))
			{
				++Result.NumNotes;
			}
		}
		if (Options.bAddNavMeshBounds && Plan.Boxes.Num() + Plan.Meshes.Num() > 0)
		{
			SpawnNavBounds();
		}

		if (PackagesToSave.Num() > 0)
		{
			UEditorLoadingAndSavingUtils::SavePackages(PackagesToSave, true);
		}
		return true;
	}

	// ---------- Backend ----------

	bool FSceneBuilder::SetupBackend()
	{
		bUseBlockout = false;
		Result.BackendUsed = TEXT("Cube");
		if (Options.Backend == ELevelLayoutBackend::Cube)
		{
			return true;
		}
		const ULevelLayoutImporterSettings* Settings = GetDefault<ULevelLayoutImporterSettings>();
		const FSoftClassPath& Path = Settings->BlockoutBoxClass;
		UClass* Class = nullptr;
		if (Path.IsValid() && FPackageName::DoesPackageExist(Path.GetLongPackageName()))
		{
			Class = Path.TryLoadClass<AActor>();
		}
		if (Class)
		{
			Blockout.Class = Class;
			if (CalibrateBlockout())
			{
				bUseBlockout = true;
				Result.BackendUsed = TEXT("Blockout");
				UE_LOG(LogLevelLayout, Log, TEXT("Using Blockout Tools: size factor %s, pivot factor %s"), *Blockout.Factor.ToString(), *Blockout.PivotK.ToString());
				return true;
			}
		}
		if (Options.Backend == ELevelLayoutBackend::Blockout)
		{
			Result.Error = Class
				? TEXT("Blockout Tools' Blockout_Box could not be measured. Use the Cube backend instead.")
				: FString::Printf(TEXT("Blockout Tools was not found (%s). Enable it in Edit > Plugins, or use the Auto or Cube backend."), *Path.ToString());
			return false;
		}
		if (Class)
		{
			Result.Warnings.Add(TEXT("Blockout Tools' Blockout_Box could not be measured; used engine cubes instead."));
		}
		return true;
	}

	AActor* FSceneBuilder::SpawnBlockoutRaw(const FVector& BoxSize, const FVector& Location, double Yaw, TFunctionRef<void(AActor*)> BeforeConstruction, bool bTransient)
	{
		ULevel* Level = World->GetCurrentLevel();
		if (!bTransient)
		{
			Level->Modify();
		}
		const FTransform Xf(FRotator(0, Yaw, 0), Location);
		FActorSpawnParameters P;
		P.OverrideLevel = Level;
		P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		P.ObjectFlags = bTransient ? RF_Transient : RF_Transactional;
		P.bDeferConstruction = true;
		AActor* A = World->SpawnActor(Blockout.Class, &Xf, P);
		if (!A)
		{
			return nullptr;
		}
		SetBoolProp(A, TEXT("bRoundSize"), false); // keep exact sizes (10 cm sub-cells would be rounded up)
		SetStructProp<FVector>(A, TEXT("BoxSize"), BoxSize);
		BeforeConstruction(A);
		A->FinishSpawning(Xf);
		return A;
	}

	bool FSceneBuilder::CalibrateBlockout()
	{
		// Measure a test box instead of relying on how the blueprint interprets BoxSize and where its pivot is.
		const FVector Test(100, 200, 300);
		AActor* A = SpawnBlockoutRaw(Test, FVector(0, 0, -100000), 0, [](AActor*) {}, true);
		if (!A)
		{
			return false;
		}
		FBox B;
		const bool bOk = MeshBounds(A, B);
		const FVector Loc = A->GetActorLocation();
		World->DestroyActor(A);
		if (!bOk)
		{
			return false;
		}
		const FVector Actual = B.GetSize();
		if (Actual.GetMin() <= KINDA_SMALL_NUMBER)
		{
			return false;
		}
		Blockout.Factor = Actual / Test;
		Blockout.PivotK = (B.GetCenter() - Loc) / Actual;
		return true;
	}

	// ---------- Spawning ----------

	AActor* FSceneBuilder::SpawnClass(UClass* Class, const FVector& Location, const FRotator& Rotation)
	{
		ULevel* Level = World->GetCurrentLevel();
		Level->Modify();
		FActorSpawnParameters P;
		P.OverrideLevel = Level;
		P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		P.ObjectFlags = RF_Transactional;
		return World->SpawnActor(Class, &Location, &Rotation, P);
	}

	template <typename T>
	T* FSceneBuilder::Spawn(const FVector& Location, const FRotator& Rotation)
	{
		return Cast<T>(SpawnClass(T::StaticClass(), Location, Rotation));
	}

	AActor* FSceneBuilder::Place(AActor* Actor, int32 Level, const FString& Label)
	{
		if (!Actor)
		{
			return nullptr;
		}
		Actor->SetActorLabel(Label);
		Actor->SetFolderPath(FName(*FString::Printf(TEXT("LevelLayout/%s/%s"), *Name, *LevelLabel(Level))));
		Actor->Tags.AddUnique(ImportedTag);
		Actor->Tags.AddUnique(Tag);
		Result.Actors.Add(Actor);
		return Actor;
	}

	AActor* FSceneBuilder::SpawnBox(const FBoxItem& Box, int32 Index)
	{
		const FString Label = FString::Printf(TEXT("%s_%04d"), *Box.Role, Index);
		const bool bLiquid = Box.Role == TEXT("water") || Box.Role == TEXT("hazard");
		if (bUseBlockout)
		{
			const FVector Size = Box.Size / Blockout.Factor;
			// Pivot offset in local space -> world space, then subtract from the wanted center.
			const FVector Local = Box.Size * Blockout.PivotK;
			const FVector World3 = FRotator(0, Box.Yaw, 0).RotateVector(Local);
			const double GridCm = 100.0 * Plan.MetersPerCell;
			const bool bGrid = GetDefault<ULevelLayoutImporterSettings>()->bMatchGridToCell;
			AActor* A = SpawnBlockoutRaw(Size, Box.Center - World3, Box.Yaw, [&](AActor* Act)
			{
				SetStructProp<FLinearColor>(Act, TEXT("BlockoutMaterialColor"), HexToLinear(Box.Color));
				SetBoolProp(Act, TEXT("bBlockoutWorldAligned"), true);
				SetBoolProp(Act, TEXT("bBlockoutMaterialUseTopColor"), false); // otherwise every top face is dark grey
				if (bGrid)
				{
					SetNumberProp(Act, TEXT("BlockoutMaterialGridSize"), GridCm);
				}
				if (bLiquid)
				{
					SetBoolProp(Act, TEXT("bBlockoutEnableCustomCollision"), true);
					SetNameProp(Act, TEXT("BlockoutCustomCollisionProfileName"), FName(TEXT("OverlapAllDynamic")));
				}
			}, false);
			return Place(A, Box.Level, Label);
		}

		AStaticMeshActor* A = Spawn<AStaticMeshActor>(Box.Center, FRotator(0, Box.Yaw, 0));
		if (!A)
		{
			return nullptr;
		}
		UStaticMeshComponent* C = A->GetStaticMeshComponent();
		C->SetStaticMesh(Cube);
		C->SetMaterial(0, MaterialFor(Box.Color));
		A->SetActorScale3D(Box.Size / 100.0);
		if (bLiquid)
		{
			C->SetCollisionProfileName(TEXT("OverlapAllDynamic"));
		}
		return Place(A, Box.Level, Label);
	}

	AActor* FSceneBuilder::SpawnMarker(const FMarkerItem& M, int32 Index)
	{
		const ULevelLayoutImporterSettings* Settings = GetDefault<ULevelLayoutImporterSettings>();
		const FRotator Rot(0, M.Yaw, 0);
		if (M.bBuilt)
		{
			// Built as geometry (door opening, stairs): just the name over it.
			return SpawnText(M.Label, M.Level, M.Location + FVector(0, 0, M.LabelHeightCm), FString::Printf(TEXT("Label_%s_%03d"), *M.Kind, Index), 40);
		}
		if (const TSoftClassPtr<AActor>* Mapped = Settings->IconActorClasses.Find(M.Kind))
		{
			if (UClass* Class = Mapped->LoadSynchronous())
			{
				return Place(SpawnClass(Class, M.Location, Rot), M.Level, FString::Printf(TEXT("%s_%03d"), *M.Kind, Index));
			}
			Result.Warnings.Add(FString::Printf(TEXT("Actor class for icon \"%s\" could not be loaded (%s); used a placeholder."), *M.Kind, *Mapped->ToString()));
		}
		if (M.Kind == TEXT("spawn"))
		{
			return Place(Spawn<APlayerStart>(M.Location + FVector(0, 0, 100), Rot), M.Level, FString::Printf(TEXT("PlayerStart_%03d"), Index));
		}
		if (M.Kind == TEXT("camera"))
		{
			return Place(Spawn<ACameraActor>(M.Location + FVector(0, 0, 300), FRotator(-30, M.Yaw, 0)), M.Level, FString::Printf(TEXT("Camera_%03d"), Index));
		}
		// Placeholder: a small cylinder and the icon's name.
		const double Size = FMath::Clamp(M.SizeCm, 30.0, 150.0);
		AStaticMeshActor* A = Spawn<AStaticMeshActor>(M.Location + FVector(0, 0, Size / 2), Rot);
		if (!A)
		{
			return nullptr;
		}
		const bool bEnemy = M.Kind == TEXT("enemy") || M.Kind == TEXT("boss");
		UStaticMeshComponent* C = A->GetStaticMeshComponent();
		C->SetStaticMesh(Cylinder);
		C->SetCollisionProfileName(TEXT("NoCollision"));
		C->SetMaterial(0, MaterialFor(bEnemy ? TEXT("#d9455f") : TEXT("#4fc1b5")));
		A->SetActorScale3D(FVector(Size / 100.0));
		Place(A, M.Level, FString::Printf(TEXT("%s_%s_%03d"), bEnemy ? TEXT("EnemySpawn") : TEXT("Marker"), *M.Kind, Index));
		SpawnText(M.Label, M.Level, M.Location + FVector(0, 0, Size + 20), FString::Printf(TEXT("Label_%03d"), Index), 40);
		return A;
	}

	AActor* FSceneBuilder::SpawnText(const FString& Text, int32 Level, const FVector& Location, const FString& Label, double WorldSize)
	{
		// Lying flat, facing up, reads along +X in the top view (checked in UE 5.8).
		ATextRenderActor* A = Spawn<ATextRenderActor>(Location, FRotator(90, 90, 0));
		if (!A)
		{
			return nullptr;
		}
		UTextRenderComponent* C = A->GetTextRender();
		if (Font)
		{
			C->SetFont(Font); // TextRender swaps the font texture into its material automatically
		}
		C->SetText(FText::FromString(Text));
		C->SetWorldSize(WorldSize);
		C->SetHorizontalAlignment(EHTA_Center);
		C->SetTextRenderColor(FColor(40, 40, 40));
		return Place(A, Level, Label);
	}

	AActor* FSceneBuilder::SpawnNavBounds()
	{
		FBox B = Plan.GetBounds();
		if (!B.IsValid)
		{
			return nullptr;
		}
		// Room around the walls, and head room for a character above the highest floor.
		B.Min -= FVector(200, 200, 100);
		B.Max += FVector(200, 200, 300);
		ANavMeshBoundsVolume* V = SpawnBrushVolume<ANavMeshBoundsVolume>(B.GetCenter(), B.GetSize(), 0);
		if (!V)
		{
			return nullptr;
		}
		Place(V, Plan.Boxes.Num() > 0 ? Plan.Boxes[0].Level : 1, TEXT("NavMeshBounds"));
		V->SetFolderPath(FName(*FString::Printf(TEXT("LevelLayout/%s"), *Name)));
		return V;
	}

	template <typename T>
	T* FSceneBuilder::SpawnBrushVolume(const FVector& Center, const FVector& Size, double Yaw)
	{
		T* V = Spawn<T>(Center, FRotator(0, Yaw, 0));
		if (!V)
		{
			return nullptr;
		}
		UCubeBuilder* Builder = NewObject<UCubeBuilder>();
		Builder->X = (float)Size.X;
		Builder->Y = (float)Size.Y;
		Builder->Z = (float)Size.Z;
		UActorFactory::CreateBrushForVolumeActor(V, Builder);
		V->PostEditChange();
		return V;
	}

	AActor* FSceneBuilder::SpawnVolume(const FVolumeItem& Vol, int32 Index)
	{
		if (Vol.Role == TEXT("water"))
		{
			APhysicsVolume* V = SpawnBrushVolume<APhysicsVolume>(Vol.Center, Vol.Size, Vol.Yaw);
			if (V)
			{
				V->bWaterVolume = true;
				V->FluidFriction = 0.3f;
			}
			return Place(V, Vol.Level, FString::Printf(TEXT("WaterVolume_%03d"), Index));
		}
		APainCausingVolume* V = SpawnBrushVolume<APainCausingVolume>(Vol.Center, Vol.Size, Vol.Yaw);
		if (V)
		{
			V->bPainCausing = true;
			V->DamagePerSec = 20.0f;
		}
		return Place(V, Vol.Level, FString::Printf(TEXT("HazardVolume_%03d"), Index));
	}

	AActor* FSceneBuilder::SpawnMesh(const FMeshItem& M, int32 Index)
	{
		FVector2D C(0, 0);
		for (const FVector2D& P : M.Points)
		{
			C += P;
		}
		C /= M.Points.Num();
		const FVector Pivot(C.X, C.Y, M.ZBottom);
		UStaticMesh* Mesh = BuildPrismMesh(M, Pivot);
		if (!Mesh)
		{
			Result.Warnings.Add(FString::Printf(TEXT("%s: could not build the mesh for a filled %s shape."), *LevelLabel(M.Level), *M.Role));
			return nullptr;
		}
		AStaticMeshActor* A = Spawn<AStaticMeshActor>(Pivot, FRotator::ZeroRotator);
		if (!A)
		{
			return nullptr;
		}
		UStaticMeshComponent* Comp = A->GetStaticMeshComponent();
		Comp->SetStaticMesh(Mesh);
		if (M.Role == TEXT("water") || M.Role == TEXT("hazard"))
		{
			Comp->SetCollisionProfileName(TEXT("OverlapAllDynamic"));
		}
		return Place(A, M.Level, FString::Printf(TEXT("%s_shape_%03d"), *M.Role, Index));
	}

	UStaticMesh* FSceneBuilder::BuildPrismMesh(const FMeshItem& M, const FVector& Pivot)
	{
		// One asset per distinct shape (outline relative to its pivot, height, color), reused by later imports.
		TArray<FVector3f> Ring; // bottom ring relative to the pivot
		for (const FVector2D& P : M.Points)
		{
			Ring.Add(FVector3f((float)(P.X - Pivot.X), (float)(P.Y - Pivot.Y), 0.f));
		}
		const float H = (float)M.Height;
		uint32 Hash = FCrc::MemCrc32(Ring.GetData(), Ring.Num() * sizeof(FVector3f));
		Hash = FCrc::MemCrc32(&H, sizeof(H), Hash);
		Hash = FCrc::StrCrc32(*M.Color, Hash);
		const FString AssetName = FString::Printf(TEXT("SM_%s_%08x"), *M.Role, Hash);
		const FString PackageName = AssetFolder() / TEXT("Meshes") / AssetName;
		if (UStaticMesh* Existing = LoadObject<UStaticMesh>(nullptr, *(PackageName + TEXT(".") + AssetName), nullptr, LOAD_NoWarn | LOAD_Quiet))
		{
			return Existing;
		}

		// Make the outline counter-clockwise in X / Y (signed area > 0) so every face can be wound the same way.
		double Area2 = 0;
		for (int32 I = 0; I < Ring.Num(); ++I)
		{
			const FVector3f& A = Ring[I];
			const FVector3f& B = Ring[(I + 1) % Ring.Num()];
			Area2 += (double)A.X * B.Y - (double)B.X * A.Y;
		}
		if (Area2 < 0)
		{
			Algo::Reverse(Ring);
		}

		FMeshDescription Desc;
		FStaticMeshAttributes Attr(Desc);
		Attr.Register();
		TVertexAttributesRef<FVector3f> Positions = Attr.GetVertexPositions();
		TVertexInstanceAttributesRef<FVector3f> Normals = Attr.GetVertexInstanceNormals();
		TVertexInstanceAttributesRef<FVector2f> UVs = Attr.GetVertexInstanceUVs();
		UVs.SetNumChannels(1);
		const FPolygonGroupID Group = Desc.CreatePolygonGroup();
		Attr.GetPolygonGroupMaterialSlotNames()[Group] = FName(TEXT("Color"));

		// Each face gets its own vertices (flat shading, simple UVs: 1 UV = 1 m, projected along the face normal).
		auto AddTriangle = [&](const FVector3f& P0, const FVector3f& P1, const FVector3f& P2, const FVector3f& WantNormal)
		{
			// UE treats (P2 - P0) x (P1 - P0) as the front normal; order the corners so it points outward.
			FVector3f Q0 = P0, Q1 = P1, Q2 = P2;
			if (FVector3f::DotProduct(FVector3f::CrossProduct(Q2 - Q0, Q1 - Q0), WantNormal) < 0)
			{
				Swap(Q1, Q2);
			}
			TArray<FVertexInstanceID, TFixedAllocator<3>> Corners;
			for (const FVector3f& Q : {Q0, Q1, Q2})
			{
				const FVertexID V = Desc.CreateVertex();
				Positions[V] = Q;
				const FVertexInstanceID I = Desc.CreateVertexInstance(V);
				Normals[I] = WantNormal;
				const FVector2f UV = FMath::Abs(WantNormal.Z) > 0.5f ? FVector2f(Q.X, Q.Y) : FVector2f(Q.X + Q.Y, -Q.Z);
				UVs.Set(I, 0, UV / 100.f);
				Corners.Add(I);
			}
			Desc.CreateTriangle(Group, Corners);
		};
		const FVector3f Up(0, 0, H);
		for (int32 I = 1; I + 1 < Ring.Num(); ++I) // convex: a fan covers the top and bottom
		{
			AddTriangle(Ring[0] + Up, Ring[I] + Up, Ring[I + 1] + Up, FVector3f(0, 0, 1));
			AddTriangle(Ring[0], Ring[I], Ring[I + 1], FVector3f(0, 0, -1));
		}
		for (int32 I = 0; I < Ring.Num(); ++I)
		{
			const FVector3f& A = Ring[I];
			const FVector3f& B = Ring[(I + 1) % Ring.Num()];
			const FVector3f Edge = B - A;
			const FVector3f Out = FVector3f(Edge.Y, -Edge.X, 0).GetSafeNormal(); // outward for a counter-clockwise ring
			AddTriangle(A, B, B + Up, Out);
			AddTriangle(A, B + Up, A + Up, Out);
		}

		UPackage* Package = CreatePackage(*PackageName);
		UStaticMesh* Mesh = NewObject<UStaticMesh>(Package, FName(*AssetName), RF_Public | RF_Standalone | RF_Transactional);
		Mesh->GetStaticMaterials().Add(FStaticMaterial(MaterialFor(M.Color), FName(TEXT("Color")), FName(TEXT("Color"))));
		UStaticMesh::FBuildMeshDescriptionsParams Params;
		Params.bBuildSimpleCollision = false;
		Params.bCommitMeshDescription = true;
		Params.bMarkPackageDirty = true;
		Params.bUseHashAsGuid = true;
		Params.bFastBuild = false;
		Mesh->BuildFromMeshDescriptions({&Desc}, Params);

		// Simple collision: the prism itself (it is convex).
		Mesh->CreateBodySetup();
		if (UBodySetup* Body = Mesh->GetBodySetup())
		{
			Body->RemoveSimpleCollision();
			FKConvexElem Convex;
			for (const FVector3f& P : Ring)
			{
				Convex.VertexData.Add(FVector(P));
				Convex.VertexData.Add(FVector(P + Up));
			}
			Convex.UpdateElemBox();
			Body->AggGeom.ConvexElems.Add(Convex);
			Body->InvalidatePhysicsData();
			Body->CreatePhysicsMeshes();
		}
		Mesh->MarkPackageDirty();
		FAssetRegistryModule::AssetCreated(Mesh);
		PackagesToSave.AddUnique(Package);
		return Mesh;
	}

	// ---------- Assets ----------

	UMaterialInterface* FSceneBuilder::MaterialFor(const FString& HexColor)
	{
		if (UMaterialInterface** Found = Materials.Find(HexColor))
		{
			return *Found;
		}
		const FString Folder = AssetFolder();
		const FString AssetName = TEXT("MI_") + HexColor.Replace(TEXT("#"), TEXT(""));
		const FString ObjectPath = Folder / AssetName + TEXT(".") + AssetName;
		UMaterialInterface* Parent = LoadObject<UMaterialInterface>(nullptr, BaseMaterialPath);
		UMaterialInstanceConstant* MI = LoadObject<UMaterialInstanceConstant>(nullptr, *ObjectPath, nullptr, LOAD_NoWarn | LOAD_Quiet);
		if (!MI)
		{
			UMaterialInstanceConstantFactoryNew* Factory = NewObject<UMaterialInstanceConstantFactoryNew>();
			Factory->InitialParent = Parent;
			IAssetTools& AssetTools = FModuleManager::LoadModuleChecked<FAssetToolsModule>("AssetTools").Get();
			MI = Cast<UMaterialInstanceConstant>(AssetTools.CreateAsset(AssetName, Folder, UMaterialInstanceConstant::StaticClass(), Factory));
		}
		if (!MI)
		{
			Result.Warnings.Add(FString::Printf(TEXT("Could not create material %s; used the default material."), *ObjectPath));
			Materials.Add(HexColor, Parent);
			return Parent;
		}
		if (MI->Parent != Parent)
		{
			MI->SetParentEditorOnly(Parent);
		}
		MI->SetVectorParameterValueEditorOnly(FMaterialParameterInfo(TEXT("Color")), HexToLinear(HexColor));
		MI->PostEditChange();
		MI->MarkPackageDirty();
		PackagesToSave.AddUnique(MI->GetOutermost());
		Materials.Add(HexColor, MI);
		return MI;
	}

	UFont* FSceneBuilder::ResolveFont()
	{
		if (!Options.Font.IsNull())
		{
			UFont* F = Options.Font.LoadSynchronous();
			if (!F)
			{
				Result.Warnings.Add(FString::Printf(TEXT("Font %s could not be loaded; text uses the default font."), *Options.Font.ToString()));
				return nullptr;
			}
			if (F->FontCacheType != EFontCacheType::Offline)
			{
				Result.Warnings.Add(FString::Printf(TEXT("Font %s is not an Offline font, which Text Render needs; text uses the default font."), *F->GetPathName()));
				return nullptr;
			}
			return F;
		}
		TSet<TCHAR> Extra;
		auto Collect = [&Extra](const FString& S)
		{
			for (const TCHAR C : S)
			{
				if (C > 126 && !FChar::IsWhitespace(C))
				{
					Extra.Add(C);
				}
			}
		};
		for (const FNoteItem& N : Plan.Notes)
		{
			Collect(N.Text);
		}
		for (const FMarkerItem& M : Plan.Markers)
		{
			Collect(M.Label);
		}
		if (Extra.Num() == 0)
		{
			return nullptr; // ASCII only: the default font has every glyph
		}
		if (!Options.bGenerateCjkFont)
		{
			Result.Warnings.Add(TEXT("Text has non-ASCII characters but no Font is set; they may show as boxes."));
			return nullptr;
		}
		TArray<TCHAR> Sorted = Extra.Array();
		Sorted.Sort();
		FString Chars;
		for (int32 C = 32; C < 127; ++C)
		{
			Chars.AppendChar((TCHAR)C);
		}
		for (const TCHAR C : Sorted)
		{
			Chars.AppendChar(C);
		}
		UFont* F = GenerateCjkFont(Chars);
		if (!F)
		{
			Result.Warnings.Add(TEXT("Could not generate a CJK font from a system font; non-ASCII text may show as boxes. Set an Offline Font in the options."));
		}
		return F;
	}

	UFont* FSceneBuilder::GenerateCjkFont(const FString& Chars)
	{
		// Text Render only supports Offline (texture) fonts and the engine's have no CJK glyphs, so build one from a
		// Windows system font with just the characters used. The font file itself never enters the repository.
		const FString Folder = AssetFolder();
		const FString AssetName = FString::Printf(TEXT("Font_CJK_%08x"), FCrc::StrCrc32(*Chars));
		if (UFont* Existing = LoadObject<UFont>(nullptr, *(Folder / AssetName + TEXT(".") + AssetName), nullptr, LOAD_NoWarn | LOAD_Quiet))
		{
			return Existing; // same characters were generated before
		}

		FString FontName;
#if PLATFORM_WINDOWS
		FString WinDir = FPlatformMisc::GetEnvironmentVariable(TEXT("WINDIR"));
		if (WinDir.IsEmpty())
		{
			WinDir = TEXT("C:/Windows");
		}
		for (const auto& Entry : CjkFonts)
		{
			if (FPaths::FileExists(FPaths::Combine(WinDir, TEXT("Fonts"), Entry[1])))
			{
				FontName = Entry[0];
				break;
			}
		}
#endif
		if (FontName.IsEmpty())
		{
			UE_LOG(LogLevelLayout, Warning, TEXT("No CJK system font found (Microsoft YaHei, SimHei, DengXian, SimSun)."));
			return nullptr;
		}

		UTrueTypeFontFactory* Factory = NewObject<UTrueTypeFontFactory>();
		if (!Factory->ImportOptions)
		{
			Factory->ImportOptions = NewObject<UFontImportOptions>(Factory);
		}
		FFontImportOptionsData& Data = Factory->ImportOptions->Data;
		Data.FontName = FontName;
		Data.Height = (float)FontHeight;
		Data.Chars = Chars;
		Data.bEnableAntialiasing = true;
		// The engine's Text Render material reads a distance field from the color channel; a plain alpha font
		// renders as solid blocks. Render at 8x and downsample into a distance field.
		Data.bUseDistanceFieldAlpha = true;
		Data.DistanceFieldScaleFactor = 8;
		Data.TexturePageWidth = 1024;
		Data.TexturePageMaxHeight = 1024;

		IAssetTools& AssetTools = FModuleManager::LoadModuleChecked<FAssetToolsModule>("AssetTools").Get();
		UFont* F = Cast<UFont>(AssetTools.CreateAsset(AssetName, Folder, UFont::StaticClass(), Factory));
		if (!F || F->Textures.Num() == 0)
		{
			UE_LOG(LogLevelLayout, Warning, TEXT("TrueTypeFontFactory did not produce a font with texture pages."));
			return nullptr;
		}
		for (UTexture2D* Page : F->Textures)
		{
			if (Page)
			{
				Page->LODGroup = TEXTUREGROUP_UI; // no mips; also rebuilds the texture
				Page->PostEditChange();
			}
		}
		F->MarkPackageDirty();
		PackagesToSave.AddUnique(F->GetOutermost());
		UE_LOG(LogLevelLayout, Log, TEXT("Generated CJK font %s from system font %s (%d characters, height %d)."), *F->GetPathName(), *FontName, Chars.Len(), FontHeight);
		return F;
	}
}

#undef LOCTEXT_NAMESPACE

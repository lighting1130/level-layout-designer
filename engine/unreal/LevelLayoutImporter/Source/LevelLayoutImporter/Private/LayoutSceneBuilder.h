// Level Layout Importer - MIT License
//
// Places a LevelLayout::FPlan into an editor world: boxes, markers, text, nav bounds.

#pragma once

#include "CoreMinimal.h"
#include "LayoutPlan.h"
#include "LevelLayoutTypes.h"

class AActor;
class UFont;
class UMaterialInterface;
class UMaterialInstanceConstant;
class UPackage;
class UStaticMesh;
class UWorld;

namespace LevelLayout
{
	/** Actor tag shared by everything any import generated. */
	extern const FName ImportedTag;

	/** Project name -> a name that is safe for asset paths, tags and folders. */
	FString SafeName(const FString& Name);

	/** Tag of the actors generated for one project. */
	FName ProjectTag(const FString& SafeProjectName);

	/** Destroy imported actors (all when the tag is NAME_None). Records undo when inside a transaction. */
	int32 RemoveActorsWithTag(UWorld* World, FName Tag);

	class FSceneBuilder
	{
	public:
		FSceneBuilder(UWorld* InWorld, const FPlan& InPlan, const FLevelLayoutImportOptions& InOptions, FLevelLayoutImportResult& InResult);

		/** Spawn everything. False (with Result.Error) when nothing could be generated. */
		bool Run();

	private:
		struct FBlockout
		{
			UClass* Class = nullptr;
			FVector Factor = FVector::OneVector; // actual size / BoxSize
			FVector PivotK = FVector::ZeroVector; // (bounds center - actor location) / actual size
		};

		bool SetupBackend();
		bool CalibrateBlockout();
		AActor* SpawnBlockoutRaw(const FVector& BoxSize, const FVector& Location, double Yaw, TFunctionRef<void(AActor*)> BeforeConstruction, bool bTransient);

		AActor* SpawnBox(const FBoxItem& Box, int32 Index);
		AActor* SpawnMarker(const FMarkerItem& Marker, int32 Index);
		AActor* SpawnText(const FString& Text, int32 Level, const FVector& Location, const FString& Label, double WorldSize);
		AActor* SpawnNavBounds();

		template <typename T>
		T* Spawn(const FVector& Location, const FRotator& Rotation);
		AActor* SpawnClass(UClass* Class, const FVector& Location, const FRotator& Rotation);
		AActor* Place(AActor* Actor, int32 Level, const FString& Label);

		UMaterialInterface* MaterialFor(const FString& HexColor);
		UFont* ResolveFont();
		UFont* GenerateCjkFont(const FString& Chars);

		FString AssetFolder() const;

		UWorld* World;
		const FPlan& Plan;
		const FLevelLayoutImportOptions& Options;
		FLevelLayoutImportResult& Result;

		FString Name; // safe project name
		FName Tag;
		bool bUseBlockout = false;
		FBlockout Blockout;
		UStaticMesh* Cube = nullptr;
		UStaticMesh* Cylinder = nullptr;
		UFont* Font = nullptr;
		TMap<FString, UMaterialInterface*> Materials;
		TArray<UPackage*> PackagesToSave;
	};
}

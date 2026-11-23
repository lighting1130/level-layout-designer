// Level Layout Importer - MIT License

#include "LayoutPlan.h"

#include "Dom/JsonObject.h"
#include "Misc/FileHelper.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace LevelLayout
{
	static const TCHAR* FormatName = TEXT("level-layout-designer");
	static constexpr int32 MaxVersion = 5;
	static constexpr double CellSize = 32.0; // world units of a base cell
	static constexpr int64 Subdivision = 10;

	// ---------- JSON helpers ----------

	static bool GetNumber(const TSharedPtr<FJsonObject>& O, const TCHAR* Field, double& Out)
	{
		const TSharedPtr<FJsonValue> V = O.IsValid() ? O->TryGetField(Field) : nullptr;
		if (!V.IsValid() || V->Type != EJson::Number)
		{
			return false;
		}
		Out = V->AsNumber();
		return FMath::IsFinite(Out);
	}

	static bool GetInt(const TSharedPtr<FJsonObject>& O, const TCHAR* Field, int64& Out)
	{
		double D = 0;
		if (!GetNumber(O, Field, D) || FMath::Floor(D) != D || FMath::Abs(D) > 9.0e15)
		{
			return false;
		}
		Out = (int64)D;
		return true;
	}

	static bool GetString(const TSharedPtr<FJsonObject>& O, const TCHAR* Field, FString& Out)
	{
		const TSharedPtr<FJsonValue> V = O.IsValid() ? O->TryGetField(Field) : nullptr;
		if (!V.IsValid() || V->Type != EJson::String)
		{
			return false;
		}
		Out = V->AsString();
		return true;
	}

	static bool GetBool(const TSharedPtr<FJsonObject>& O, const TCHAR* Field)
	{
		const TSharedPtr<FJsonValue> V = O.IsValid() ? O->TryGetField(Field) : nullptr;
		if (!V.IsValid())
		{
			return false;
		}
		if (V->Type == EJson::Boolean)
		{
			return V->AsBool();
		}
		if (V->Type == EJson::Number)
		{
			return V->AsNumber() != 0;
		}
		return false;
	}

	static TArray<TSharedPtr<FJsonObject>> GetObjects(const TSharedPtr<FJsonObject>& O, const TCHAR* Field)
	{
		TArray<TSharedPtr<FJsonObject>> Out;
		const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
		if (O.IsValid() && O->TryGetArrayField(Field, Arr))
		{
			for (const TSharedPtr<FJsonValue>& V : *Arr)
			{
				if (V.IsValid() && V->Type == EJson::Object)
				{
					Out.Add(V->AsObject());
				}
			}
		}
		return Out;
	}

	static bool GetPoint(const TSharedPtr<FJsonObject>& O, const TCHAR* Field, FVector2D& Out)
	{
		const TSharedPtr<FJsonObject>* P = nullptr;
		if (!O.IsValid() || !O->TryGetObjectField(Field, P) || !P)
		{
			return false;
		}
		double X = 0, Y = 0;
		if (!GetNumber(*P, TEXT("x"), X) || !GetNumber(*P, TEXT("y"), Y))
		{
			return false;
		}
		Out = FVector2D(X, Y);
		return true;
	}

	static TOptional<double> GetOptionalNumber(const TSharedPtr<FJsonObject>& O, const TCHAR* Field)
	{
		double D = 0;
		if (GetNumber(O, Field, D))
		{
			return D;
		}
		return TOptional<double>();
	}

	// ---------- Parsing ----------

	static void ParseFloorContent(const TSharedPtr<FJsonObject>& F, FFloor& Floor)
	{
		for (const TSharedPtr<FJsonObject>& C : GetObjects(F, TEXT("cells")))
		{
			int64 K = 0, I = 0, J = 0;
			FString Color;
			if (GetInt(C, TEXT("k"), K) && GetInt(C, TEXT("i"), I) && GetInt(C, TEXT("j"), J) && GetString(C, TEXT("color"), Color)
				&& K >= -8 && K <= 8) // k < 0 = finer sub-cells; the range keeps Pow10 differences inside int64
			{
				FCell Cell;
				Cell.Key = FCellKey{(int32)K, I, J};
				Cell.Color = Color.ToLower();
				Floor.Cells.Add(MoveTemp(Cell));
			}
		}
		for (const TSharedPtr<FJsonObject>& V : GetObjects(F, TEXT("vectors")))
		{
			FVectorShape S;
			if (!GetString(V, TEXT("kind"), S.Kind) || !GetPoint(V, TEXT("a"), S.A) || !GetPoint(V, TEXT("b"), S.B))
			{
				continue;
			}
			S.bHasBend = GetPoint(V, TEXT("bend"), S.Bend);
			S.bConstrain = GetBool(V, TEXT("constrain"));
			GetString(V, TEXT("color"), S.Color);
			S.Color = S.Color.ToLower();
			GetNumber(V, TEXT("width"), S.Width);
			S.bFill = GetBool(V, TEXT("fill"));
			int64 Sides = 5, Rot = 0;
			if (GetInt(V, TEXT("sides"), Sides) && Sides > 0)
			{
				S.Sides = (int32)FMath::Clamp<int64>(Sides, 3, 64);
			}
			if (GetInt(V, TEXT("rot"), Rot))
			{
				S.Rot = (int32)(((Rot % 4) + 4) % 4);
			}
			Floor.Vectors.Add(MoveTemp(S));
		}
		for (const TSharedPtr<FJsonObject>& Ic : GetObjects(F, TEXT("icons")))
		{
			FIcon Icon;
			if (!GetString(Ic, TEXT("kind"), Icon.Kind) || !GetNumber(Ic, TEXT("x"), Icon.X) || !GetNumber(Ic, TEXT("y"), Icon.Y))
			{
				continue;
			}
			double Size = 0;
			Icon.Size = (GetNumber(Ic, TEXT("size"), Size) && Size > 0) ? Size : CellSize;
			double Rot = 0;
			if (GetNumber(Ic, TEXT("rot"), Rot))
			{
				Icon.Rot = FMath::Fmod(FMath::Fmod(Rot, 360.0) + 360.0, 360.0);
			}
			Floor.Icons.Add(MoveTemp(Icon));
		}
		for (const TSharedPtr<FJsonObject>& N : GetObjects(F, TEXT("notes")))
		{
			FNote Note;
			if (GetString(N, TEXT("text"), Note.Text) && GetNumber(N, TEXT("x"), Note.X) && GetNumber(N, TEXT("y"), Note.Y))
			{
				Floor.Notes.Add(MoveTemp(Note));
			}
		}
	}

	bool ParseProject(const FString& JsonText, FProject& Out, FString& OutError)
	{
		Out = FProject();
		TSharedPtr<FJsonObject> Root;
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonText);
		if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
		{
			OutError = FString::Printf(TEXT("The file is not valid JSON: %s"), *Reader->GetErrorMessage());
			return false;
		}
		FString Format;
		if (!GetString(Root, TEXT("format"), Format) || Format != FormatName)
		{
			OutError = TEXT("This is not a Level Layout Designer project file.");
			return false;
		}
		double Version = 0;
		if (!GetNumber(Root, TEXT("version"), Version) || Version > MaxVersion)
		{
			OutError = FString::Printf(TEXT("Project file version %g is newer than this importer supports (max %d). Update the plugin."), Version, MaxVersion);
			return false;
		}

		if (!GetString(Root, TEXT("name"), Out.Name) || Out.Name.IsEmpty())
		{
			Out.Name = TEXT("Untitled");
		}
		double Mpc = 0;
		Out.MetersPerCell = (GetNumber(Root, TEXT("metersPerCell"), Mpc) && Mpc > 0) ? Mpc : 1.0;

		for (const TSharedPtr<FJsonObject>& E : GetObjects(Root, TEXT("legend")))
		{
			FLegendEntry L;
			if (!GetString(E, TEXT("color"), L.Color))
			{
				continue;
			}
			L.Color = L.Color.ToLower();
			GetString(E, TEXT("id"), L.Id);
			GetString(E, TEXT("name"), L.Name);
			GetString(E, TEXT("role"), L.Role);
			L.Height = GetOptionalNumber(E, TEXT("height"));
			Out.Legend.Add(MoveTemp(L));
		}

		const TSharedPtr<FJsonObject>* Labels = nullptr;
		if (Root->TryGetObjectField(TEXT("iconLabels"), Labels) && Labels)
		{
			for (const auto& Pair : (*Labels)->Values)
			{
				if (Pair.Value.IsValid() && Pair.Value->Type == EJson::String)
				{
					Out.IconLabels.Add(FString(*Pair.Key), Pair.Value->AsString()); // Key is FSharedString in UE 5.8, FString before
				}
			}
		}
		for (const TSharedPtr<FJsonObject>& C : GetObjects(Root, TEXT("customIcons")))
		{
			FString Id, Name;
			if (GetString(C, TEXT("id"), Id) && GetString(C, TEXT("name"), Name))
			{
				Out.CustomIconNames.Add(Id, Name);
			}
		}

		const TArray<TSharedPtr<FJsonValue>>* FloorsArr = nullptr;
		if (Root->TryGetArrayField(TEXT("floors"), FloorsArr))
		{
			for (const TSharedPtr<FJsonObject>& F : GetObjects(Root, TEXT("floors")))
			{
				int64 Level = 0;
				if (!GetInt(F, TEXT("level"), Level) || Level == 0 || FMath::Abs(Level) > 1000)
				{
					continue;
				}
				FFloor Floor;
				Floor.Level = (int32)Level;
				Floor.Elevation = GetOptionalNumber(F, TEXT("elevation"));
				Floor.WallHeight = GetOptionalNumber(F, TEXT("wallHeight"));
				ParseFloorContent(F, Floor);
				Out.Floors.Add(MoveTemp(Floor));
			}
		}
		else
		{
			// Versions 1 and 2: top-level cells / vectors, treated as the first level.
			FFloor Floor;
			Floor.Level = 1;
			ParseFloorContent(Root, Floor);
			Out.Floors.Add(MoveTemp(Floor));
		}
		return true;
	}

	bool LoadProjectFile(const FString& Path, FProject& Out, FString& OutError)
	{
		FString Text;
		if (!FFileHelper::LoadFileToString(Text, *Path))
		{
			OutError = FString::Printf(TEXT("Cannot read file: %s"), *Path);
			return false;
		}
		return ParseProject(Text, Out, OutError);
	}

	// ---------- Cell flattening ----------

	static int64 FloorDiv(int64 A, int64 B)
	{
		int64 Q = A / B;
		if ((A % B != 0) && ((A < 0) != (B < 0)))
		{
			--Q;
		}
		return Q;
	}

	static int64 Pow10(int32 N)
	{
		int64 R = 1;
		for (int32 X = 0; X < N; ++X)
		{
			R *= Subdivision;
		}
		return R;
	}

	/** The cell at coarser level K2 (>= Key.K) that contains Key. */
	static FCellKey Ancestor(const FCellKey& Key, int32 K2)
	{
		const int64 F = Pow10(K2 - Key.K);
		return FCellKey{K2, FloorDiv(Key.I, F), FloorDiv(Key.J, F)};
	}

	TMap<FCellKey, FString> FlattenCells(const TArray<FCell>& Cells)
	{
		TMap<FCellKey, FString> Out;
		if (Cells.Num() == 0)
		{
			return Out;
		}
		int32 KMax = Cells[0].Key.K;
		for (const FCell& C : Cells)
		{
			KMax = FMath::Max(KMax, C.Key.K);
		}
		// Ancestor index: coarse cell key -> existing finer cells inside it.
		TMap<FCellKey, TSet<FCellKey>> Desc;

		auto Add = [&](const FCellKey& Key, const FString& Color)
		{
			Out.Add(Key, Color);
			for (int32 K2 = Key.K + 1; K2 <= KMax; ++K2)
			{
				Desc.FindOrAdd(Ancestor(Key, K2)).Add(Key);
			}
		};
		auto Remove = [&](const FCellKey& Key)
		{
			Out.Remove(Key);
			for (int32 K2 = Key.K + 1; K2 <= KMax; ++K2)
			{
				if (TSet<FCellKey>* S = Desc.Find(Ancestor(Key, K2)))
				{
					S->Remove(Key);
				}
			}
		};

		for (const FCell& C : Cells)
		{
			const FCellKey& Key = C.Key;
			// 1. Remove everything it covers (same level or finer).
			if (Out.Contains(Key))
			{
				Remove(Key);
			}
			if (const TSet<FCellKey>* D = Desc.Find(Key))
			{
				const TArray<FCellKey> Covered = D->Array();
				for (const FCellKey& Sub : Covered)
				{
					Remove(Sub);
				}
			}
			// 2. If it lands inside a coarser cell, split that cell down to this level.
			for (int32 K2 = Key.K + 1; K2 <= KMax; ++K2)
			{
				const FCellKey P = Ancestor(Key, K2);
				if (const FString* Found = Out.Find(P))
				{
					const FString PColor = *Found;
					Remove(P);
					FCellKey Cur = P;
					for (int32 Lvl = K2 - 1; Lvl >= Key.K; --Lvl)
					{
						const FCellKey Target = Ancestor(Key, Lvl);
						for (int64 DI = 0; DI < Subdivision; ++DI)
						{
							for (int64 DJ = 0; DJ < Subdivision; ++DJ)
							{
								const FCellKey Child{Lvl, Cur.I * Subdivision + DI, Cur.J * Subdivision + DJ};
								if (!(Child == Target))
								{
									Add(Child, PColor);
								}
							}
						}
						Cur = Target;
					}
					break; // existing cells never overlap, so there is at most one ancestor
				}
			}
			Add(Key, C.Color);
		}
		return Out;
	}

	// ---------- Greedy rectangles ----------

	TArray<FRect64> GreedyRects64(const TArray<TPair<int64, int64>>& Cells)
	{
		TSet<TPair<int64, int64>> Left(Cells);
		TArray<TPair<int64, int64>> Sorted = Left.Array();
		Sorted.Sort([](const TPair<int64, int64>& A, const TPair<int64, int64>& B)
		{
			return A.Value != B.Value ? A.Value < B.Value : A.Key < B.Key;
		});
		TArray<FRect64> Rects;
		for (const TPair<int64, int64>& P : Sorted)
		{
			if (!Left.Contains(P))
			{
				continue;
			}
			const int64 I = P.Key, J = P.Value;
			int64 W = 1;
			while (Left.Contains(TPair<int64, int64>(I + W, J)))
			{
				++W;
			}
			int64 H = 1;
			for (;;)
			{
				bool bRow = true;
				for (int64 X = 0; X < W && bRow; ++X)
				{
					bRow = Left.Contains(TPair<int64, int64>(I + X, J + H));
				}
				if (!bRow)
				{
					break;
				}
				++H;
			}
			for (int64 Y = 0; Y < H; ++Y)
			{
				for (int64 X = 0; X < W; ++X)
				{
					Left.Remove(TPair<int64, int64>(I + X, J + Y));
				}
			}
			Rects.Add(FRect64{I, J, W, H});
		}
		return Rects;
	}

	TArray<FRect64> GreedyRects(const TSet<FIntPoint>& Cells)
	{
		TArray<TPair<int64, int64>> Pairs;
		Pairs.Reserve(Cells.Num());
		for (const FIntPoint& P : Cells)
		{
			Pairs.Emplace(P.X, P.Y);
		}
		return GreedyRects64(Pairs);
	}

	// ---------- Roles and levels ----------

	static bool IsRole(const FString& R)
	{
		return R == TEXT("wall") || R == TEXT("floor") || R == TEXT("water") || R == TEXT("hazard") || R == TEXT("marker") || R == TEXT("none");
	}

	FString GuessRole(const FString& InName)
	{
		// Legend names in the web tool's default palette (Chinese and English). Non-ASCII names are written
		// as \u escapes so the source stays ASCII.
		static const TMap<FString, FString> Roles = []
		{
			TMap<FString, FString> M;
			M.Add(TEXT("\u5899\u4F53"), TEXT("wall")); // qiang ti
			M.Add(TEXT("\u5899"), TEXT("wall"));
			M.Add(TEXT("wall"), TEXT("wall"));
			M.Add(TEXT("walls"), TEXT("wall"));
			M.Add(TEXT("\u5730\u9762"), TEXT("floor")); // di mian
			M.Add(TEXT("\u8349\u5730"), TEXT("floor")); // cao di
			M.Add(TEXT("floor"), TEXT("floor"));
			M.Add(TEXT("ground"), TEXT("floor"));
			M.Add(TEXT("grass"), TEXT("floor"));
			M.Add(TEXT("\u6C34\u57DF"), TEXT("water")); // shui yu
			M.Add(TEXT("\u6C34"), TEXT("water"));
			M.Add(TEXT("water"), TEXT("water"));
			M.Add(TEXT("\u5CA9\u6D46/\u4F24\u5BB3\u533A"), TEXT("hazard")); // yan jiang / shang hai qu
			M.Add(TEXT("\u5CA9\u6D46"), TEXT("hazard"));
			M.Add(TEXT("\u4F24\u5BB3\u533A"), TEXT("hazard"));
			M.Add(TEXT("lava"), TEXT("hazard"));
			M.Add(TEXT("hazard"), TEXT("hazard"));
			M.Add(TEXT("lava/hazard"), TEXT("hazard"));
			M.Add(TEXT("lava / hazard"), TEXT("hazard"));
			M.Add(TEXT("damage"), TEXT("hazard"));
			return M;
		}();
		const FString Name = InName.TrimStartAndEnd();
		if (const FString* R = Roles.Find(Name))
		{
			return *R;
		}
		// FString keys compare case-insensitively in TMap, so the lower-case fallback is already covered.
		return TEXT("marker");
	}

	double DefaultElevation(int32 Level, double FloorHeightM)
	{
		return (Level > 0 ? Level - 1 : Level) * FloorHeightM;
	}

	FString LevelLabel(int32 Level)
	{
		return Level < 0 ? FString::Printf(TEXT("B%d"), -Level) : FString::Printf(TEXT("%dF"), Level);
	}

	// ---------- Smooth shapes ----------

	bool ArcCircle(const FVector2D& A, const FVector2D& B, const FVector2D& Bend, FVector2D& OutCenter, double& OutR, double& OutT0, double& OutSweep)
	{
		// Circle through start A, control point Bend and end B (same as the web tool's arcCircle).
		const double Ax = A.X, Ay = A.Y, Bx = Bend.X, By = Bend.Y, Cx = B.X, Cy = B.Y;
		const double D = 2 * (Ax * (By - Cy) + Bx * (Cy - Ay) + Cx * (Ay - By));
		const double Chord = FMath::Sqrt((Cx - Ax) * (Cx - Ax) + (Cy - Ay) * (Cy - Ay));
		const double Dist = FMath::Abs((Cx - Ax) * (Ay - By) - (Ax - Bx) * (Cy - Ay)) / (Chord > 0 ? Chord : 1);
		if (FMath::Abs(D) < 1e-12 || Dist < Chord * 0.01)
		{
			return false;
		}
		const double A2 = Ax * Ax + Ay * Ay, B2 = Bx * Bx + By * By, C2 = Cx * Cx + Cy * Cy;
		const double Ux = (A2 * (By - Cy) + B2 * (Cy - Ay) + C2 * (Ay - By)) / D;
		const double Uy = (A2 * (Cx - Bx) + B2 * (Ax - Cx) + C2 * (Bx - Ax)) / D;
		OutCenter = FVector2D(Ux, Uy);
		OutR = FMath::Sqrt((Ax - Ux) * (Ax - Ux) + (Ay - Uy) * (Ay - Uy));
		const double T0 = FMath::Atan2(Ay - Uy, Ax - Ux);
		const double Tm = FMath::Atan2(By - Uy, Bx - Ux);
		const double T1 = FMath::Atan2(Cy - Uy, Cx - Ux);
		auto Norm = [](double T)
		{
			const double R = FMath::Fmod(T, 2 * UE_DOUBLE_PI);
			return R < 0 ? R + 2 * UE_DOUBLE_PI : R;
		};
		const double Ccw = Norm(T1 - T0);
		OutT0 = T0;
		OutSweep = Norm(Tm - T0) <= Ccw ? Ccw : Ccw - 2 * UE_DOUBLE_PI; // the side that passes through Bend
		return true;
	}

	static void ShapeBox(FVector2D A, FVector2D B, bool bConstrain, double& X0, double& Y0, double& W, double& H)
	{
		X0 = FMath::Min(A.X, B.X);
		Y0 = FMath::Min(A.Y, B.Y);
		W = FMath::Abs(B.X - A.X);
		H = FMath::Abs(B.Y - A.Y);
		if (bConstrain)
		{
			const double M = FMath::Max(W, H);
			if (B.X < A.X)
			{
				X0 = A.X - M;
			}
			if (B.Y < A.Y)
			{
				Y0 = A.Y - M;
			}
			W = H = M;
		}
	}

	bool ShapeOutline(const FVectorShape& V, double SegmentWorld, TArray<FVector2D>& OutPoints, bool& bOutClosed)
	{
		OutPoints.Reset();
		bOutClosed = false;
		FVector2D A = V.A, B = V.B;
		const double Seg = SegmentWorld > 0 ? SegmentWorld : CellSize;
		if (V.Kind == TEXT("line"))
		{
			if (V.bConstrain)
			{
				const FVector2D D = B - A;
				const double Len = D.Size();
				const double Ang = FMath::RoundToDouble(FMath::Atan2(D.Y, D.X) / (UE_DOUBLE_PI / 4)) * (UE_DOUBLE_PI / 4);
				B = A + FVector2D(Len * FMath::Cos(Ang), Len * FMath::Sin(Ang));
			}
			OutPoints = {A, B};
			return true;
		}
		if (V.Kind == TEXT("arc"))
		{
			FVector2D U;
			double R = 0, T0 = 0, Sweep = 0;
			if (!V.bHasBend || !ArcCircle(A, B, V.Bend, U, R, T0, Sweep))
			{
				OutPoints = {A, B};
				return true;
			}
			const int32 N = FMath::Max(2, FMath::CeilToInt(FMath::Abs(Sweep) * R / Seg));
			for (int32 M = 0; M <= N; ++M)
			{
				const double T = T0 + Sweep * M / N;
				OutPoints.Add(U + FVector2D(R * FMath::Cos(T), R * FMath::Sin(T)));
			}
			return true;
		}

		const int32 Rot = V.Rot;
		if (Rot % 2 == 1)
		{
			// A and B are the rotated bounding box; swap back to the unrotated one, build, then rotate again.
			const FVector2D C = (A + B) / 2;
			const double Hw = FMath::Abs(B.X - A.X) / 2, Hh = FMath::Abs(B.Y - A.Y) / 2;
			A = FVector2D(C.X - Hh, C.Y - Hw);
			B = FVector2D(C.X + Hh, C.Y + Hw);
		}
		double X0, Y0, W, H;
		ShapeBox(A, B, V.bConstrain, X0, Y0, W, H);
		const double Cx = X0 + W / 2, Cy = Y0 + H / 2;
		TArray<FVector2D> Pts;
		if (V.Kind == TEXT("rect"))
		{
			Pts = {{X0, Y0}, {X0 + W, Y0}, {X0 + W, Y0 + H}, {X0, Y0 + H}};
		}
		else if (V.Kind == TEXT("triangle"))
		{
			Pts = {{Cx, Y0}, {X0 + W, Y0 + H}, {X0, Y0 + H}};
		}
		else if (V.Kind == TEXT("diamond"))
		{
			Pts = {{Cx, Y0}, {X0 + W, Cy}, {Cx, Y0 + H}, {X0, Cy}};
		}
		else if (V.Kind == TEXT("hexagon"))
		{
			for (int32 N = 0; N < 6; ++N)
			{
				Pts.Add({Cx + W / 2 * FMath::Cos(UE_DOUBLE_PI / 3 * N), Cy + H / 2 * FMath::Sin(UE_DOUBLE_PI / 3 * N)});
			}
		}
		else if (V.Kind == TEXT("polygon"))
		{
			const int32 N = FMath::Clamp(V.Sides, 3, 64);
			for (int32 M = 0; M < N; ++M)
			{
				const double T = -UE_DOUBLE_PI / 2 + 2 * UE_DOUBLE_PI * M / N;
				Pts.Add({Cx + W / 2 * FMath::Cos(T), Cy + H / 2 * FMath::Sin(T)});
			}
		}
		else if (V.Kind == TEXT("ellipse"))
		{
			const double Per = UE_DOUBLE_PI * (W + H) / 2;
			const int32 N = FMath::Max(12, FMath::CeilToInt(Per / Seg));
			for (int32 M = 0; M < N; ++M)
			{
				const double T = 2 * UE_DOUBLE_PI * M / N;
				OutPoints.Add({Cx + W / 2 * FMath::Cos(T), Cy + H / 2 * FMath::Sin(T)});
			}
			bOutClosed = true;
			return true; // ellipses are not rotated
		}
		else
		{
			return false;
		}
		// Rotate Rot quarter turns clockwise around the center (canvas y is down: (x, y) -> (-y, x)).
		for (FVector2D& P : Pts)
		{
			double Dx = P.X - Cx, Dy = P.Y - Cy;
			for (int32 Q = 0; Q < Rot % 4; ++Q)
			{
				const double T = Dx;
				Dx = -Dy;
				Dy = T;
			}
			P = FVector2D(Cx + Dx, Cy + Dy);
		}
		OutPoints = MoveTemp(Pts);
		bOutClosed = true;
		return true;
	}

	struct FFlatBox
	{
		double Cx, Cy, Length, Width, Yaw;
	};

	/**
	 * Smooth shape -> boxes in cm. A filled shape that is not a rectangle goes to OutPolygon (cm) instead.
	 * Returns false when the shape cannot be built.
	 */
	static bool VectorBoxes(const FVectorShape& V, double W2Cm, const FPlanSettings& S, TArray<FFlatBox>& Out, TArray<FVector2D>& OutPolygon)
	{
		Out.Reset();
		OutPolygon.Reset();
		const double Width = V.Width;
		if (!(Width > 0))
		{
			return true;
		}
		const double SegWorld = S.ArcSegmentM * 100.0 / W2Cm;
		TArray<FVector2D> Pts;
		bool bClosed = false;
		if (!ShapeOutline(V, SegWorld, Pts, bClosed))
		{
			return false;
		}
		if (bClosed && V.bFill)
		{
			if (V.Kind != TEXT("rect"))
			{
				// Every filled kind except rect (ellipse, triangle, diamond, hexagon, regular polygon) is convex.
				if (Pts.Num() < 3)
				{
					return false;
				}
				for (const FVector2D& P : Pts)
				{
					OutPolygon.Add(P * W2Cm);
				}
				return true;
			}
			FBox2D Bx(ForceInit);
			for (const FVector2D& P : Pts)
			{
				Bx += P;
			}
			// The web tool strokes on both sides of the outline: grow by half a line width each side.
			const FVector2D C = Bx.GetCenter();
			Out.Add({C.X * W2Cm, C.Y * W2Cm, (Bx.Max.X - Bx.Min.X + Width) * W2Cm, (Bx.Max.Y - Bx.Min.Y + Width) * W2Cm, 0.0});
			return true;
		}
		const int32 NumSegs = bClosed ? Pts.Num() : Pts.Num() - 1;
		for (int32 Idx = 0; Idx < NumSegs; ++Idx)
		{
			const FVector2D& P0 = Pts[Idx];
			const FVector2D& P1 = Pts[(Idx + 1) % Pts.Num()];
			const double Dx = (P1.X - P0.X) * W2Cm, Dy = (P1.Y - P0.Y) * W2Cm;
			const double Len = FMath::Sqrt(Dx * Dx + Dy * Dy);
			if (Len < 1e-6)
			{
				continue;
			}
			// Extend each segment by half the line width at both ends so corners have no gaps.
			Out.Add({(P0.X + P1.X) / 2 * W2Cm, (P0.Y + P1.Y) / 2 * W2Cm, Len + Width * W2Cm, Width * W2Cm,
				FMath::RadiansToDegrees(FMath::Atan2(Dy, Dx))});
		}
		return true;
	}

	// ---------- Box cutting ----------

	static FVector2D Rot2(const FVector2D& V, double YawDeg)
	{
		const double T = FMath::DegreesToRadians(YawDeg);
		const double C = FMath::Cos(T), Sn = FMath::Sin(T);
		return FVector2D(V.X * C - V.Y * Sn, V.X * Sn + V.Y * C);
	}

	bool SubtractBox(const FBoxItem& Box, const FVector& CutCenter, const FVector& CutSize, double CutYaw, TArray<FBoxItem>& OutPieces)
	{
		OutPieces.Reset();
		// Work in the box's local frame. The cut must be axis-aligned there.
		double D = FMath::Fmod(CutYaw - Box.Yaw, 360.0);
		if (D < 0)
		{
			D += 360.0;
		}
		const double Quarter = D / 90.0;
		const int32 Q = FMath::RoundToInt(Quarter);
		if (FMath::Abs(Quarter - Q) > 0.001)
		{
			return false;
		}
		FVector CutHalf = CutSize / 2;
		if (Q % 2 == 1)
		{
			Swap(CutHalf.X, CutHalf.Y);
		}
		const FVector2D L = Rot2(FVector2D(CutCenter.X - Box.Center.X, CutCenter.Y - Box.Center.Y), -Box.Yaw);
		const FVector LocalC(L.X, L.Y, CutCenter.Z - Box.Center.Z);
		const FVector BHalf = Box.Size / 2;
		const FVector BMin = -BHalf, BMax = BHalf;
		const FVector CMin = LocalC - CutHalf, CMax = LocalC + CutHalf;
		constexpr double Eps = 0.01;
		for (int32 A = 0; A < 3; ++A)
		{
			if (CMax[A] <= BMin[A] + Eps || CMin[A] >= BMax[A] - Eps)
			{
				return false; // no overlap
			}
		}
		auto AddPiece = [&](FVector Lo, FVector Hi)
		{
			const FVector Size = Hi - Lo;
			if (Size.X < 0.5 || Size.Y < 0.5 || Size.Z < 0.5)
			{
				return; // slivers
			}
			const FVector LocalCenter = (Lo + Hi) / 2;
			const FVector2D W = Rot2(FVector2D(LocalCenter.X, LocalCenter.Y), Box.Yaw);
			FBoxItem Piece = Box;
			Piece.Center = FVector(Box.Center.X + W.X, Box.Center.Y + W.Y, Box.Center.Z + LocalCenter.Z);
			Piece.Size = Size;
			OutPieces.Add(MoveTemp(Piece));
		};
		// Split along X, then the middle slab along Y, then the middle column along Z.
		FVector Lo = BMin, Hi = BMax;
		for (int32 A = 0; A < 3; ++A)
		{
			const double C0 = FMath::Max(CMin[A], Lo[A]);
			const double C1 = FMath::Min(CMax[A], Hi[A]);
			FVector PLo = Lo, PHi = Hi;
			PHi[A] = C0;
			AddPiece(PLo, PHi);
			PLo = Lo;
			PHi = Hi;
			PLo[A] = C1;
			AddPiece(PLo, PHi);
			Lo[A] = C0;
			Hi[A] = C1;
		}
		return true;
	}

	/** Cut every box of the given roles on a level with an oriented box. Returns how many boxes were cut. */
	static int32 CutBoxes(FPlan& Plan, int32 Level, const TArray<FString>& Roles, const FVector& Center, const FVector& Size, double Yaw)
	{
		int32 NumCut = 0;
		TArray<FBoxItem> Out;
		Out.Reserve(Plan.Boxes.Num());
		TArray<FBoxItem> Pieces;
		for (const FBoxItem& B : Plan.Boxes)
		{
			if (B.Level == Level && Roles.Contains(B.Role) && SubtractBox(B, Center, Size, Yaw, Pieces))
			{
				++NumCut;
				Out.Append(Pieces);
			}
			else
			{
				Out.Add(B);
			}
		}
		Plan.Boxes = MoveTemp(Out);
		return NumCut;
	}

	/** Is the point inside the box footprint (grown by Margin)? Also returns the point in the box's local frame. */
	static bool FootprintContains(const FBoxItem& B, const FVector2D& P, double Margin, FVector2D& OutLocal)
	{
		OutLocal = Rot2(P - FVector2D(B.Center.X, B.Center.Y), -B.Yaw);
		return FMath::Abs(OutLocal.X) <= B.Size.X / 2 + Margin && FMath::Abs(OutLocal.Y) <= B.Size.Y / 2 + Margin;
	}

	// ---------- Doors ----------

	static void CutDoors(FPlan& Plan, const FPlanSettings& S)
	{
		const double DoorW = S.DoorWidthM * 100.0, DoorH = S.DoorHeightM * 100.0;
		const TArray<FString> WallRoles = {TEXT("wall")};
		for (FMarkerItem& M : Plan.Markers)
		{
			if (M.Kind != TEXT("door") && M.Kind != TEXT("locked"))
			{
				continue;
			}
			const FVector2D P(M.Location.X, M.Location.Y);
			// The wall the icon sits on: the one whose footprint contains it, the thinnest if several do.
			const FBoxItem* Host = nullptr;
			FVector2D HostLocal;
			for (const FBoxItem& B : Plan.Boxes)
			{
				FVector2D Local;
				if (B.Level == M.Level && B.Role == TEXT("wall") && FootprintContains(B, P, 25.0, Local)
					&& (!Host || FMath::Min(B.Size.X, B.Size.Y) < FMath::Min(Host->Size.X, Host->Size.Y)))
				{
					Host = &B;
					HostLocal = Local;
				}
			}
			if (!Host)
			{
				Plan.Warnings.Add(FString::Printf(TEXT("%s: the %s icon at (%.0f, %.0f) cm is not on a wall; no opening was cut."),
					*LevelLabel(M.Level), *M.Kind, M.Location.X, M.Location.Y));
				continue;
			}
			// The opening runs along the wall's long axis, through its whole thickness.
			const bool bAlongX = Host->Size.X >= Host->Size.Y;
			const double Thick = bAlongX ? Host->Size.Y : Host->Size.X;
			const double WallBottom = Host->Center.Z - Host->Size.Z / 2;
			const FVector2D LocalCenter = bAlongX ? FVector2D(HostLocal.X, 0) : FVector2D(0, HostLocal.Y);
			const FVector2D WorldCenter = FVector2D(Host->Center.X, Host->Center.Y) + Rot2(LocalCenter, Host->Yaw);
			const double Yaw = bAlongX ? Host->Yaw : Host->Yaw + 90.0;
			const FVector CutCenter(WorldCenter.X, WorldCenter.Y, WallBottom + DoorH / 2 - 1.0);
			const FVector CutSize(DoorW, Thick + 10.0, DoorH + 2.0); // a little extra so no skin is left at the floor
			CutBoxes(Plan, M.Level, WallRoles, CutCenter, CutSize, Yaw);
			M.bBuilt = true;
			M.LabelHeightCm = DoorH + 30.0;
		}
	}

	// ---------- Stairs ----------

	struct FStairRun
	{
		int32 Lower = 0, Upper = 0;
		FVector2D Center;
	};

	static void BuildStairs(FPlan& Plan, const FPlanSettings& S, const TMap<int32, double>& AllZ)
	{
		const double Width = S.StairWidthM * 100.0;
		const double Tread = FMath::Max(S.StairTreadM, 0.05) * 100.0;
		const double MaxRiser = FMath::Max(S.StairMaxRiserM, 0.02) * 100.0;
		const double SlabT = S.FloorThicknessM * 100.0;
		const TArray<FString> SlabRoles = {TEXT("floor"), TEXT("water"), TEXT("hazard")};
		TArray<FStairRun> Built;

		// Stairs-up first, so a matching stairs-down on the level above is recognized as the same stairs.
		for (int32 Pass = 0; Pass < 2; ++Pass)
		{
			const TCHAR* Kind = Pass == 0 ? TEXT("stairs-up") : TEXT("stairs-down");
			for (FMarkerItem& M : Plan.Markers)
			{
				if (M.Kind != Kind)
				{
					continue;
				}
				const double* OwnZ = AllZ.Find(M.Level);
				if (!OwnZ)
				{
					continue;
				}
				// The nearest level above (stairs-up) or below (stairs-down).
				int32 Other = 0;
				double OtherZ = 0;
				for (const auto& Pair : AllZ)
				{
					const bool bCandidate = Pass == 0 ? Pair.Value > *OwnZ + 1.0 : Pair.Value < *OwnZ - 1.0;
					if (bCandidate && (Other == 0 || (Pass == 0 ? Pair.Value < OtherZ : Pair.Value > OtherZ)))
					{
						Other = Pair.Key;
						OtherZ = Pair.Value;
					}
				}
				if (Other == 0)
				{
					Plan.Warnings.Add(FString::Printf(TEXT("%s: %s icon has no level %s it; no stairs were built."),
						*LevelLabel(M.Level), Kind, Pass == 0 ? TEXT("above") : TEXT("below")));
					continue;
				}
				const int32 Lower = Pass == 0 ? M.Level : Other;
				const int32 Upper = Pass == 0 ? Other : M.Level;
				const double LowerZ = Pass == 0 ? *OwnZ : OtherZ;
				const double UpperZ = Pass == 0 ? OtherZ : *OwnZ;
				const FVector2D C(M.Location.X, M.Location.Y);

				// Already built from the other level's icon?
				const FStairRun* Same = Built.FindByPredicate([&](const FStairRun& R)
				{
					return R.Lower == Lower && R.Upper == Upper && FVector2D::Distance(R.Center, C) < FMath::Max(Width, 300.0);
				});
				if (Same)
				{
					M.bBuilt = true;
					M.LabelHeightCm = 30.0;
					continue;
				}

				// Icon at the middle of the run; yaw = the direction going up (icon facing for stairs-up, the reverse for stairs-down).
				const double Yaw = Pass == 0 ? M.Yaw : M.Yaw + 180.0;
				const double Rise = UpperZ - LowerZ;
				const int32 N = FMath::Max(1, FMath::CeilToInt(Rise / MaxRiser - 1e-6));
				const double Riser = Rise / N;
				const double Run = N * Tread;
				for (int32 I = 0; I < N; ++I)
				{
					const double Along = -Run / 2 + (I + 0.5) * Tread;
					const double Height = (I + 1) * Riser;
					const FVector2D W = C + Rot2(FVector2D(Along, 0), Yaw);
					FBoxItem Step;
					Step.Role = TEXT("stairs");
					Step.Color = TEXT("#a7adb7");
					Step.Level = Lower;
					Step.Center = FVector(W.X, W.Y, LowerZ + Height / 2);
					Step.Size = FVector(Tread, Width, Height);
					Step.Yaw = Yaw;
					Plan.Boxes.Add(MoveTemp(Step));
				}
				// Stairwell: open the upper level's floor over the whole run, so there is head room; the top step meets its edge.
				if (Plan.LevelZ.Contains(Upper))
				{
					const FVector HoleCenter(C.X, C.Y, UpperZ - SlabT);
					CutBoxes(Plan, Upper, SlabRoles, HoleCenter, FVector(Run, Width, 4 * SlabT), Yaw);
				}
				Built.Add({Lower, Upper, C});
				M.bBuilt = true;
				M.LabelHeightCm = 30.0;
			}
		}
	}

	// ---------- Volumes ----------

	static void BuildVolumes(FPlan& Plan)
	{
		for (const FBoxItem& B : Plan.Boxes)
		{
			if (B.Role != TEXT("water") && B.Role != TEXT("hazard"))
			{
				continue;
			}
			const double* Z0 = Plan.LevelZ.Find(B.Level);
			const double Bottom = B.Center.Z - B.Size.Z / 2;
			const double Top = (Z0 ? *Z0 : B.Center.Z) + 100.0; // a character standing in it overlaps
			FVolumeItem V;
			V.Role = B.Role;
			V.Level = B.Level;
			V.Center = FVector(B.Center.X, B.Center.Y, (Bottom + Top) / 2);
			V.Size = FVector(B.Size.X, B.Size.Y, Top - Bottom);
			V.Yaw = B.Yaw;
			Plan.Volumes.Add(MoveTemp(V));
		}
		for (const FMeshItem& M : Plan.Meshes)
		{
			if (M.Role != TEXT("water") && M.Role != TEXT("hazard"))
			{
				continue;
			}
			// Volumes are boxes: use the outline's bounds.
			const FBox2D B(M.Points);
			const double* Z0 = Plan.LevelZ.Find(M.Level);
			const double Top = (Z0 ? *Z0 : M.ZBottom + M.Height) + 100.0;
			FVolumeItem V;
			V.Role = M.Role;
			V.Level = M.Level;
			V.Center = FVector(B.GetCenter().X, B.GetCenter().Y, (M.ZBottom + Top) / 2);
			V.Size = FVector(B.GetSize().X, B.GetSize().Y, Top - M.ZBottom);
			Plan.Volumes.Add(MoveTemp(V));
		}
	}

	// ---------- Plan ----------

	FBox FPlan::GetBounds() const
	{
		FBox B(ForceInit);
		for (const FBoxItem& Item : Boxes)
		{
			FVector Half = Item.Size / 2;
			if (Item.Yaw != 0)
			{
				const double R = FMath::Sqrt(Item.Size.X * Item.Size.X + Item.Size.Y * Item.Size.Y) / 2;
				Half.X = Half.Y = R;
			}
			B += FBox(Item.Center - Half, Item.Center + Half);
		}
		for (const FMarkerItem& M : Markers)
		{
			B += M.Location;
		}
		for (const FMeshItem& M : Meshes)
		{
			for (const FVector2D& P : M.Points)
			{
				B += FVector(P.X, P.Y, M.ZBottom);
				B += FVector(P.X, P.Y, M.ZBottom + M.Height);
			}
		}
		return B;
	}

	FPlan BuildPlan(const FProject& Project, const FPlanSettings& S)
	{
		FPlan Plan;
		Plan.Name = Project.Name;
		Plan.MetersPerCell = Project.MetersPerCell;
		const double W2Cm = Project.MetersPerCell * 100.0 / CellSize;

		TMap<FString, const FLegendEntry*> LegendByColor;
		for (const FLegendEntry& E : Project.Legend)
		{
			if (!LegendByColor.Contains(E.Color))
			{
				LegendByColor.Add(E.Color, &E);
			}
		}
		auto RoleOf = [&](const FString& Color) -> FString
		{
			const FLegendEntry* const* E = LegendByColor.Find(Color);
			if (!E)
			{
				return TEXT("floor");
			}
			if (IsRole((*E)->Role))
			{
				return (*E)->Role;
			}
			return GuessRole((*E)->Name);
		};
		TSet<FString> UnknownColors;

		// Elevation (cm) of every level in the file, also the ones not imported: stairs need their neighbors.
		TMap<int32, double> AllZ;
		for (const FFloor& F : Project.Floors)
		{
			if (!AllZ.Contains(F.Level))
			{
				AllZ.Add(F.Level, (F.Elevation.IsSet() ? F.Elevation.GetValue() : DefaultElevation(F.Level, S.FloorHeightM)) * 100.0);
			}
		}

		for (const FFloor& F : Project.Floors)
		{
			const int32 Lv = F.Level;
			if (S.Levels.Num() > 0 && !S.Levels.Contains(Lv))
			{
				continue;
			}
			const double Z0 = (F.Elevation.IsSet() ? F.Elevation.GetValue() : DefaultElevation(Lv, S.FloorHeightM)) * 100.0;
			Plan.LevelZ.Add(Lv, Z0);
			const double WallH = ((F.WallHeight.IsSet() && F.WallHeight.GetValue() > 0) ? F.WallHeight.GetValue() : S.WallHeightM) * 100.0;
			const double Thick = S.FloorThicknessM * 100.0;

			// Bottom z and height (cm) of a slab with this role.
			auto Slab = [&](const FString& Role, const FString& Color, double& OutBottom, double& OutHeight)
			{
				if (Role == TEXT("wall"))
				{
					const FLegendEntry* const* E = LegendByColor.Find(Color);
					const TOptional<double> H = E ? (*E)->Height : TOptional<double>();
					OutBottom = Z0;
					OutHeight = (H.IsSet() && H.GetValue() > 0) ? H.GetValue() * 100.0 : WallH;
				}
				else if (Role == TEXT("water") || Role == TEXT("hazard"))
				{
					OutBottom = Z0 - S.LiquidDepthM * 100.0 - Thick;
					OutHeight = Thick;
				}
				else
				{
					OutBottom = Z0 - Thick;
					OutHeight = Thick;
				}
			};

			// Cells, grouped by (color, level of detail).
			const TMap<FCellKey, FString> Flat = FlattenCells(F.Cells);
			TMap<TPair<FString, int32>, TArray<TPair<int64, int64>>> Groups;
			for (const auto& Pair : Flat)
			{
				Groups.FindOrAdd(TPair<FString, int32>(Pair.Value, Pair.Key.K)).Emplace(Pair.Key.I, Pair.Key.J);
			}
			TArray<TPair<FString, int32>> GroupKeys;
			Groups.GetKeys(GroupKeys);
			GroupKeys.Sort([](const TPair<FString, int32>& A, const TPair<FString, int32>& B)
			{
				return A.Key != B.Key ? A.Key < B.Key : A.Value < B.Value;
			});
			for (const TPair<FString, int32>& GK : GroupKeys)
			{
				const FString& Color = GK.Key;
				if (!LegendByColor.Contains(Color))
				{
					UnknownColors.Add(Color);
				}
				const FString Role = RoleOf(Color);
				if (Role == TEXT("marker") || Role == TEXT("none"))
				{
					continue;
				}
				const double Step = CellSize * FMath::Pow((double)Subdivision, (double)GK.Value) * W2Cm; // GK.Value < 0 for sub-cells
				double Zb, H;
				Slab(Role, Color, Zb, H);
				for (const FRect64& R : GreedyRects64(Groups[GK]))
				{
					FBoxItem Box;
					Box.Role = Role;
					Box.Color = Color;
					Box.Level = Lv;
					Box.Center = FVector((R.I + R.W / 2.0) * Step, (R.J + R.H / 2.0) * Step, Zb + H / 2);
					Box.Size = FVector(R.W * Step, R.H * Step, H);
					Plan.Boxes.Add(MoveTemp(Box));
				}
			}

			// Smooth shapes.
			int32 Skipped = 0;
			for (const FVectorShape& V : F.Vectors)
			{
				const FString Role = RoleOf(V.Color);
				if (Role == TEXT("marker") || Role == TEXT("none"))
				{
					continue;
				}
				if (!LegendByColor.Contains(V.Color))
				{
					UnknownColors.Add(V.Color);
				}
				double Zb, H;
				Slab(Role, V.Color, Zb, H);
				TArray<FFlatBox> Flats;
				TArray<FVector2D> Polygon;
				if (!VectorBoxes(V, W2Cm, S, Flats, Polygon))
				{
					++Skipped;
					continue;
				}
				if (Polygon.Num() >= 3)
				{
					FMeshItem Mesh;
					Mesh.Role = Role;
					Mesh.Color = V.Color;
					Mesh.Level = Lv;
					Mesh.Points = MoveTemp(Polygon);
					Mesh.ZBottom = Zb;
					Mesh.Height = H;
					Plan.Meshes.Add(MoveTemp(Mesh));
				}
				for (const FFlatBox& Fb : Flats)
				{
					FBoxItem Box;
					Box.Role = Role;
					Box.Color = V.Color;
					Box.Level = Lv;
					Box.Center = FVector(Fb.Cx, Fb.Cy, Zb + H / 2);
					Box.Size = FVector(Fb.Length, Fb.Width, H);
					Box.Yaw = Fb.Yaw;
					Box.bFromVector = true;
					Plan.Boxes.Add(MoveTemp(Box));
				}
			}
			if (Skipped > 0)
			{
				Plan.Warnings.Add(FString::Printf(TEXT("%s: %d smooth shape(s) could not be built and were skipped."),
					*LevelLabel(Lv), Skipped));
			}

			// Icons.
			for (const FIcon& Ic : F.Icons)
			{
				FString Label;
				if (const FString* L = Project.IconLabels.Find(Ic.Kind))
				{
					Label = *L;
				}
				else if (Ic.Kind.StartsWith(TEXT("u:")))
				{
					if (const FString* N = Project.CustomIconNames.Find(Ic.Kind.Mid(2)))
					{
						Label = *N;
					}
				}
				if (Label.IsEmpty())
				{
					Label = Ic.Kind;
				}
				FMarkerItem M;
				M.Kind = Ic.Kind;
				M.Label = Label;
				M.Level = Lv;
				M.Location = FVector(Ic.X * W2Cm, Ic.Y * W2Cm, Z0);
				M.SizeCm = Ic.Size * W2Cm;
				M.Yaw = Ic.Rot; // clockwise from +X, same as UE yaw
				Plan.Markers.Add(MoveTemp(M));
			}

			// Notes.
			for (const FNote& N : F.Notes)
			{
				FNoteItem Item;
				Item.Text = N.Text;
				Item.Level = Lv;
				Item.Location = FVector(N.X * W2Cm, N.Y * W2Cm, Z0 + 50.0);
				Plan.Notes.Add(MoveTemp(Item));
			}
		}

		if (S.bCutDoors)
		{
			CutDoors(Plan, S);
		}
		if (S.bBuildStairs)
		{
			BuildStairs(Plan, S, AllZ);
		}
		BuildVolumes(Plan);

		if (UnknownColors.Num() > 0)
		{
			TArray<FString> Sorted = UnknownColors.Array();
			Sorted.Sort();
			Plan.Warnings.Add(TEXT("These colors are not in the legend and were built as floor: ") + FString::Join(Sorted, TEXT(", ")));
		}
		return Plan;
	}
}

// Level Layout Importer - MIT License
//
// Project file -> whitebox "build plan". Pure data, no actors: easy to test.
// Same algorithm as engine/unreal/prototype/layout_core.py.
//
// Coordinates: the web tool's world units (a base cell is 32 units, x right, y down) map straight onto
// UE X / Y in centimeters (UE is left-handed, so seen from the top X is right and Y is down). Z is up.

#pragma once

#include "CoreMinimal.h"

class FJsonObject;

namespace LevelLayout
{
	/** A painted cell at subdivision level K (edge = 32 * 10^K world units), column I, row J. */
	struct FCellKey
	{
		int32 K = 0;
		int64 I = 0;
		int64 J = 0;

		bool operator==(const FCellKey& O) const { return K == O.K && I == O.I && J == O.J; }
		friend uint32 GetTypeHash(const FCellKey& C)
		{
			return HashCombine(HashCombine(::GetTypeHash(C.K), ::GetTypeHash(C.I)), ::GetTypeHash(C.J));
		}
	};

	struct FCell
	{
		FCellKey Key;
		FString Color;
	};

	struct FVectorShape
	{
		FString Kind; // arc, line, rect, ellipse, triangle, diamond, hexagon, polygon
		FVector2D A = FVector2D::ZeroVector;
		FVector2D B = FVector2D::ZeroVector;
		bool bHasBend = false;
		FVector2D Bend = FVector2D::ZeroVector;
		bool bConstrain = false;
		FString Color;
		double Width = 0;
		bool bFill = false;
		int32 Sides = 5;
		int32 Rot = 0; // quarter turns clockwise
	};

	struct FIcon
	{
		FString Kind;
		double X = 0, Y = 0, Size = 32, Rot = 0;
	};

	struct FNote
	{
		double X = 0, Y = 0;
		FString Text;
	};

	struct FFloor
	{
		int32 Level = 1;
		TArray<FCell> Cells;
		TArray<FVectorShape> Vectors;
		TArray<FIcon> Icons;
		TArray<FNote> Notes;
		TOptional<double> Elevation; // m
		TOptional<double> WallHeight; // m
	};

	struct FLegendEntry
	{
		FString Id;
		FString Name;
		FString Color; // #rrggbb, lower case
		FString Role; // empty = guess from name
		TOptional<double> Height; // m
	};

	struct FProject
	{
		FString Name;
		double MetersPerCell = 1.0;
		TArray<FLegendEntry> Legend;
		TMap<FString, FString> IconLabels;
		TMap<FString, FString> CustomIconNames; // image id -> name
		TArray<FFloor> Floors;
	};

	struct FPlanSettings
	{
		double WallHeightM = 4.0;
		double FloorHeightM = 5.0;
		double FloorThicknessM = 0.3;
		double LiquidDepthM = 0.1;
		double ArcSegmentM = 1.0;
		TArray<int32> Levels; // empty = all
	};

	/** A box to place: center and full size in cm, yaw in degrees. */
	struct FBoxItem
	{
		FString Role;
		FString Color;
		int32 Level = 1;
		FVector Center = FVector::ZeroVector;
		FVector Size = FVector::ZeroVector;
		double Yaw = 0;
		bool bFromVector = false;
	};

	struct FMarkerItem
	{
		FString Kind;
		FString Label;
		int32 Level = 1;
		FVector Location = FVector::ZeroVector; // on the floor surface
		double SizeCm = 100;
		double Yaw = 0;
	};

	struct FNoteItem
	{
		FString Text;
		int32 Level = 1;
		FVector Location = FVector::ZeroVector;
	};

	struct FPlan
	{
		FString Name;
		double MetersPerCell = 1.0;
		TArray<FBoxItem> Boxes;
		TArray<FMarkerItem> Markers;
		TArray<FNoteItem> Notes;
		TMap<int32, double> LevelZ; // cm
		TArray<FString> Warnings;

		/** Axis-aligned bounds of all boxes and markers (cm). */
		FBox GetBounds() const;
	};

	/** Parse and validate a project file. Returns false with a reason on failure. */
	bool ParseProject(const FString& JsonText, FProject& Out, FString& OutError);
	bool LoadProjectFile(const FString& Path, FProject& Out, FString& OutError);

	/** Resolve paint order: later cells win; a finer cell inside an earlier coarser one splits it as needed. */
	TMap<FCellKey, FString> FlattenCells(const TArray<FCell>& Cells);

	/** Greedy merge of same-level cells into rectangles: (I0, J0, Width, Height) in cells. */
	struct FRect64 { int64 I = 0, J = 0, W = 1, H = 1; };
	TArray<FRect64> GreedyRects(const TSet<FIntPoint>& Cells);
	TArray<FRect64> GreedyRects64(const TArray<TPair<int64, int64>>& Cells);

	/** Role from legend role or name: wall, floor, water, hazard, marker, none. */
	FString GuessRole(const FString& Name);

	/** Default elevation of a level (m): level 1 at 0, level n at (n-1)*h, level -n at -n*h. */
	double DefaultElevation(int32 Level, double FloorHeightM);

	/** Outline of a smooth shape in world units, same as the web tool. Returns false for unknown kinds. */
	bool ShapeOutline(const FVectorShape& V, double SegmentWorld, TArray<FVector2D>& OutPoints, bool& bOutClosed);

	/** Circle through A, Bend, B; false when nearly collinear. Sweep is signed (radians). */
	bool ArcCircle(const FVector2D& A, const FVector2D& B, const FVector2D& Bend, FVector2D& OutCenter, double& OutR, double& OutT0, double& OutSweep);

	FPlan BuildPlan(const FProject& Project, const FPlanSettings& Settings);

	FString LevelLabel(int32 Level);
}

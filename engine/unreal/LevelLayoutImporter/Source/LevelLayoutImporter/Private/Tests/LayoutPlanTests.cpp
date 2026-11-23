// Level Layout Importer - MIT License
//
// Session Frontend > Automation > LevelLayout, or: UnrealEditor-Cmd.exe <project> -ExecCmds="Automation RunTests LevelLayout; Quit"
// Same cases as engine/unreal/prototype/tests/test_layout_core.py.

#include "LayoutPlan.h"

#include "Interfaces/IPluginManager.h"
#include "Misc/AutomationTest.h"
#include "Misc/Paths.h"

#if WITH_DEV_AUTOMATION_TESTS

#define LL_TEST_FLAGS (EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

using namespace LevelLayout;

namespace
{
	const TCHAR* Wall = TEXT("#8b93a3");
	const TCHAR* Floor = TEXT("#c9b48a");

	/** A version 4 project with the default wall / floor legend. Cells and vectors are JSON array bodies. */
	FString ProjectJson(const FString& Cells, const FString& Vectors = FString(), int32 Level = 1, const FString& Extra = FString())
	{
		return FString::Printf(TEXT("{\"format\":\"level-layout-designer\",\"version\":4,\"name\":\"t\",%s")
			TEXT("\"legend\":[{\"name\":\"\u5899\u4F53\",\"color\":\"%s\"},{\"name\":\"\u5730\u9762\",\"color\":\"%s\"}],")
			TEXT("\"floors\":[{\"level\":%d,\"cells\":[%s],\"vectors\":[%s]}]}"),
			*Extra, Wall, Floor, Level, *Cells, *Vectors);
	}

	FString Cell(int32 K, int64 I, int64 J, const TCHAR* Color)
	{
		return FString::Printf(TEXT("{\"k\":%d,\"i\":%lld,\"j\":%lld,\"color\":\"%s\"}"), K, I, J, Color);
	}

	bool Plan(FAutomationTestBase& T, const FString& Json, FPlan& Out, const FPlanSettings& S = FPlanSettings())
	{
		FProject P;
		FString Error;
		if (!ParseProject(Json, P, Error))
		{
			T.AddError(TEXT("Parse failed: ") + Error);
			return false;
		}
		Out = BuildPlan(P, S);
		return true;
	}

	TArray<FCell> Cells(std::initializer_list<FCell> List)
	{
		return TArray<FCell>(List);
	}

	FCell C(int32 K, int64 I, int64 J, const TCHAR* Color)
	{
		FCell Out;
		Out.Key = FCellKey{K, I, J};
		Out.Color = Color;
		return Out;
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FLevelLayoutUnitsTest, "LevelLayout.Plan.Units", LL_TEST_FLAGS)
bool FLevelLayoutUnitsTest::RunTest(const FString&)
{
	FPlan P;
	if (Plan(*this, ProjectJson(Cell(0, 0, 0, Wall)), P) && TestEqual(TEXT("one box"), P.Boxes.Num(), 1))
	{
		TestEqual(TEXT("role"), P.Boxes[0].Role, FString(TEXT("wall")));
		TestEqual(TEXT("size"), P.Boxes[0].Size, FVector(100, 100, 400));
		TestEqual(TEXT("center"), P.Boxes[0].Center, FVector(50, 50, 200));
	}
	if (Plan(*this, ProjectJson(Cell(0, 1, 0, Floor), FString(), 1, TEXT("\"metersPerCell\":2,")), P) && TestEqual(TEXT("one box"), P.Boxes.Num(), 1))
	{
		TestEqual(TEXT("2 m cells"), P.Boxes[0].Size.X, 200.0);
		TestEqual(TEXT("2 m cells x"), P.Boxes[0].Center.X, 300.0);
		TestEqual(TEXT("slab top at 0"), P.Boxes[0].Center.Z, -15.0, 1e-6);
	}
	if (Plan(*this, ProjectJson(Cell(-1, -1, 0, Wall)), P) && TestEqual(TEXT("one box"), P.Boxes.Num(), 1))
	{
		TestEqual(TEXT("fine size"), P.Boxes[0].Size.X, 10.0, 1e-6);
		TestEqual(TEXT("fine center"), P.Boxes[0].Center.X, -5.0, 1e-6);
	}
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FLevelLayoutFloorsTest, "LevelLayout.Plan.Floors", LL_TEST_FLAGS)
bool FLevelLayoutFloorsTest::RunTest(const FString&)
{
	FProject Pr;
	FString Error;
	TestTrue(TEXT("parse"), ParseProject(TEXT("{\"format\":\"level-layout-designer\",\"version\":4,\"floors\":[{\"level\":2},{\"level\":1},{\"level\":-1},{\"level\":-2,\"elevation\":-7.5}]}"), Pr, Error));
	const FPlan P = BuildPlan(Pr, FPlanSettings());
	TestEqual(TEXT("2F"), P.LevelZ.FindRef(2), 500.0);
	TestEqual(TEXT("1F"), P.LevelZ.FindRef(1), 0.0);
	TestEqual(TEXT("B1"), P.LevelZ.FindRef(-1), -500.0);
	TestEqual(TEXT("B2 elevation"), P.LevelZ.FindRef(-2), -750.0);

	FPlanSettings OnlyFirst;
	OnlyFirst.Levels = {1};
	FPlan Filtered;
	if (Plan(*this, ProjectJson(Cell(0, 0, 0, Wall), FString(), 2), Filtered, OnlyFirst))
	{
		TestEqual(TEXT("level filter"), Filtered.Boxes.Num(), 0);
	}

	FPlan V1;
	Plan(*this, FString::Printf(TEXT("{\"format\":\"level-layout-designer\",\"version\":1,\"legend\":[{\"name\":\"wall\",\"color\":\"%s\"}],\"cells\":[%s]}"), Wall, *Cell(0, 0, 0, Wall)), V1);
	TestEqual(TEXT("version 1 file"), V1.Boxes.Num(), 1);

	TestFalse(TEXT("too new"), ParseProject(TEXT("{\"format\":\"level-layout-designer\",\"version\":99}"), Pr, Error));
	TestFalse(TEXT("not a project"), ParseProject(TEXT("{\"format\":\"other\",\"version\":1}"), Pr, Error));
	TestFalse(TEXT("not json"), ParseProject(TEXT("{oops"), Pr, Error));
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FLevelLayoutFlattenTest, "LevelLayout.Plan.Flatten", LL_TEST_FLAGS)
bool FLevelLayoutFlattenTest::RunTest(const FString&)
{
	{
		const TMap<FCellKey, FString> F = FlattenCells(Cells({C(1, 0, 0, Floor), C(0, 3, 4, Wall)}));
		TestEqual(TEXT("fine over coarse splits"), F.Num(), 100);
		TestEqual(TEXT("fine cell kept"), F.FindRef(FCellKey{0, 3, 4}), FString(Wall));
		int32 NumFloor = 0;
		for (const auto& Pair : F)
		{
			NumFloor += Pair.Value == Floor ? 1 : 0;
		}
		TestEqual(TEXT("rest is floor"), NumFloor, 99);
	}
	{
		const TMap<FCellKey, FString> F = FlattenCells(Cells({C(1, 0, 0, Floor), C(-1, 5, 5, Wall)}));
		TestEqual(TEXT("two levels down"), F.FindRef(FCellKey{-1, 5, 5}), FString(Wall));
		int32 K0 = 0, Km1 = 0;
		double Area = 0;
		for (const auto& Pair : F)
		{
			K0 += Pair.Key.K == 0 ? 1 : 0;
			Km1 += Pair.Key.K == -1 ? 1 : 0;
			Area += FMath::Square(FMath::Pow(10.0, (double)Pair.Key.K));
		}
		TestEqual(TEXT("level 0 cells"), K0, 99);
		TestEqual(TEXT("level -1 cells"), Km1, 100);
		TestEqual(TEXT("area kept"), Area, 100.0, 1e-6);
	}
	{
		const TMap<FCellKey, FString> F = FlattenCells(Cells({C(0, 3, 4, Wall), C(1, 0, 0, Floor)}));
		TestEqual(TEXT("coarse over fine replaces"), F.Num(), 1);
		TestEqual(TEXT("coarse color"), F.FindRef(FCellKey{1, 0, 0}), FString(Floor));
	}
	{
		const TMap<FCellKey, FString> F = FlattenCells(Cells({C(1, -1, -1, Floor), C(0, -1, -10, Wall)}));
		TestEqual(TEXT("negative indices"), F.FindRef(FCellKey{0, -1, -10}), FString(Wall));
		TestEqual(TEXT("negative split"), F.Num(), 100);
	}
	{
		const TMap<FCellKey, FString> F = FlattenCells(Cells({C(0, 0, 0, Wall), C(0, 0, 0, Floor)}));
		TestEqual(TEXT("later wins"), F.Num(), 1);
		TestEqual(TEXT("later color"), F.FindRef(FCellKey{0, 0, 0}), FString(Floor));
	}
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FLevelLayoutGreedyTest, "LevelLayout.Plan.Greedy", LL_TEST_FLAGS)
bool FLevelLayoutGreedyTest::RunTest(const FString&)
{
	TSet<FIntPoint> Block;
	for (int32 I = 0; I < 3; ++I)
	{
		for (int32 J = 0; J < 2; ++J)
		{
			Block.Add(FIntPoint(I, J));
		}
	}
	const TArray<FRect64> R = GreedyRects(Block);
	if (TestEqual(TEXT("block is one rect"), R.Num(), 1))
	{
		TestTrue(TEXT("block rect"), R[0].I == 0 && R[0].J == 0 && R[0].W == 3 && R[0].H == 2);
	}

	const TSet<FIntPoint> L = {FIntPoint(0, 0), FIntPoint(1, 0), FIntPoint(2, 0), FIntPoint(0, 1), FIntPoint(0, 2)};
	const TArray<FRect64> LR = GreedyRects(L);
	TestEqual(TEXT("L shape rects"), LR.Num(), 2);
	TSet<FIntPoint> Covered;
	for (const FRect64& Rect : LR)
	{
		for (int64 X = 0; X < Rect.W; ++X)
		{
			for (int64 Y = 0; Y < Rect.H; ++Y)
			{
				Covered.Add(FIntPoint((int32)(Rect.I + X), (int32)(Rect.J + Y)));
			}
		}
	}
	TestTrue(TEXT("L shape covered exactly"), Covered.Num() == L.Num() && Covered.Includes(L));
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FLevelLayoutVectorsTest, "LevelLayout.Plan.Vectors", LL_TEST_FLAGS)
bool FLevelLayoutVectorsTest::RunTest(const FString&)
{
	FPlan P;
	const FString Line = FString::Printf(TEXT("{\"kind\":\"line\",\"a\":{\"x\":0,\"y\":0},\"b\":{\"x\":0,\"y\":320},\"color\":\"%s\",\"width\":32}"), Wall);
	if (Plan(*this, ProjectJson(FString(), Line), P) && TestEqual(TEXT("line box"), P.Boxes.Num(), 1))
	{
		TestEqual(TEXT("line yaw"), P.Boxes[0].Yaw, 90.0, 1e-6);
		TestEqual(TEXT("line length + half width each end"), P.Boxes[0].Size.X, 1100.0, 1e-6);
		TestEqual(TEXT("line width"), P.Boxes[0].Size.Y, 100.0, 1e-6);
		TestEqual(TEXT("line center"), P.Boxes[0].Center.Y, 500.0, 1e-6);
	}

	FVector2D U;
	double R = 0, T0 = 0, Sweep = 0;
	if (TestTrue(TEXT("arc"), ArcCircle(FVector2D(0, 0), FVector2D(320, 0), FVector2D(160, 160), U, R, T0, Sweep)))
	{
		TestEqual(TEXT("arc radius"), R, 160.0, 1e-6);
		const double Mid = T0 + Sweep / 2;
		TestEqual(TEXT("arc through bend x"), U.X + R * FMath::Cos(Mid), 160.0, 1e-6);
		TestEqual(TEXT("arc through bend y"), U.Y + R * FMath::Sin(Mid), 160.0, 1e-6);
	}
	if (TestTrue(TEXT("arc other side"), ArcCircle(FVector2D(0, 0), FVector2D(320, 0), FVector2D(160, -160), U, R, T0, Sweep)))
	{
		TestEqual(TEXT("arc other side through bend"), U.Y + R * FMath::Sin(T0 + Sweep / 2), -160.0, 1e-6);
	}
	TestFalse(TEXT("collinear arc"), ArcCircle(FVector2D(0, 0), FVector2D(320, 0), FVector2D(160, 0.5), U, R, T0, Sweep));

	const FString Rect = FString::Printf(TEXT("{\"kind\":\"rect\",\"a\":{\"x\":0,\"y\":0},\"b\":{\"x\":320,\"y\":160},\"color\":\"%s\",\"width\":8,\"fill\":false}"), Wall);
	if (Plan(*this, ProjectJson(FString(), Rect), P))
	{
		TestEqual(TEXT("unfilled rect is four walls"), P.Boxes.Num(), 4);
	}
	const FString FilledRect = FString::Printf(TEXT("{\"kind\":\"rect\",\"a\":{\"x\":0,\"y\":0},\"b\":{\"x\":320,\"y\":160},\"color\":\"%s\",\"width\":8,\"fill\":true}"), Floor);
	if (Plan(*this, ProjectJson(FString(), FilledRect), P) && TestEqual(TEXT("filled rect is one slab"), P.Boxes.Num(), 1))
	{
		TestEqual(TEXT("filled rect grows by half width"), P.Boxes[0].Size.X, 1025.0, 1e-6);
	}
	const FString Ellipse = FString::Printf(TEXT("{\"kind\":\"ellipse\",\"a\":{\"x\":0,\"y\":0},\"b\":{\"x\":64,\"y\":64},\"color\":\"%s\",\"width\":4,\"fill\":true}"), Floor);
	if (Plan(*this, ProjectJson(FString(), Ellipse), P))
	{
		TestEqual(TEXT("filled ellipse is no box"), P.Boxes.Num(), 0);
		if (TestEqual(TEXT("filled ellipse is a mesh"), P.Meshes.Num(), 1))
		{
			TestTrue(TEXT("ellipse outline"), P.Meshes[0].Points.Num() >= 12);
			TestEqual(TEXT("ellipse is a floor slab"), P.Meshes[0].Height, 30.0, 1e-6);
			TestEqual(TEXT("ellipse slab top at 0"), P.Meshes[0].ZBottom + P.Meshes[0].Height, 0.0, 1e-6);
		}
		TestEqual(TEXT("no warning"), P.Warnings.Num(), 0);
	}

	FVectorShape Tri;
	Tri.Kind = TEXT("triangle");
	Tri.A = FVector2D(0, 0);
	Tri.B = FVector2D(100, 200);
	Tri.Rot = 1;
	TArray<FVector2D> Pts;
	bool bClosed = false;
	if (TestTrue(TEXT("triangle outline"), ShapeOutline(Tri, 10, Pts, bClosed)))
	{
		FBox2D B(Pts);
		TestEqual(TEXT("rotated triangle min x"), B.Min.X, 0.0, 1e-6);
		TestEqual(TEXT("rotated triangle max x"), B.Max.X, 100.0, 1e-6);
		TestEqual(TEXT("rotated triangle min y"), B.Min.Y, 0.0, 1e-6);
		TestEqual(TEXT("rotated triangle max y"), B.Max.Y, 200.0, 1e-6);
	}
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FLevelLayoutVersion5Test, "LevelLayout.Plan.Version5", LL_TEST_FLAGS)
bool FLevelLayoutVersion5Test::RunTest(const FString&)
{
	FPlan P;
	const FString Json = TEXT("{\"format\":\"level-layout-designer\",\"version\":5,\"legend\":[")
		TEXT("{\"id\":\"low\",\"name\":\"\u77EE\u5899\",\"color\":\"#111111\",\"role\":\"wall\",\"height\":1.2},")
		TEXT("{\"id\":\"x\",\"name\":\"\u5899\u4F53\",\"color\":\"#222222\",\"role\":\"floor\"}],")
		TEXT("\"floors\":[{\"level\":1,\"wallHeight\":3,\"elevation\":2,\"cells\":[")
		TEXT("{\"k\":0,\"i\":0,\"j\":0,\"color\":\"#111111\"},{\"k\":0,\"i\":2,\"j\":0,\"color\":\"#222222\"}],")
		TEXT("\"icons\":[{\"kind\":\"spawn\",\"x\":0,\"y\":0,\"size\":32,\"rot\":270},{\"kind\":\"chest\",\"x\":0,\"y\":0,\"size\":32}]}]}");
	if (!Plan(*this, Json, P))
	{
		return false;
	}
	const FBoxItem* Low = P.Boxes.FindByPredicate([](const FBoxItem& B) { return B.Color == TEXT("#111111"); });
	const FBoxItem* Other = P.Boxes.FindByPredicate([](const FBoxItem& B) { return B.Color == TEXT("#222222"); });
	if (TestNotNull(TEXT("low wall"), Low) && TestNotNull(TEXT("floor by role"), Other))
	{
		TestEqual(TEXT("low wall role"), Low->Role, FString(TEXT("wall")));
		TestEqual(TEXT("legend height"), Low->Size.Z, 120.0, 1e-6);
		TestEqual(TEXT("elevation"), Low->Center.Z, 260.0, 1e-6);
		TestEqual(TEXT("role beats name"), Other->Role, FString(TEXT("floor")));
	}
	if (TestEqual(TEXT("icons"), P.Markers.Num(), 2))
	{
		TestEqual(TEXT("icon rot"), P.Markers[0].Yaw, 270.0, 1e-6);
		TestEqual(TEXT("icon no rot"), P.Markers[1].Yaw, 0.0, 1e-6);
	}
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FLevelLayoutSampleTest, "LevelLayout.Plan.SampleProject", LL_TEST_FLAGS)
bool FLevelLayoutSampleTest::RunTest(const FString&)
{
	const TSharedPtr<IPlugin> Plugin = IPluginManager::Get().FindPlugin(TEXT("LevelLayoutImporter"));
	if (!TestTrue(TEXT("plugin found"), Plugin.IsValid()))
	{
		return false;
	}
	FProject Pr;
	FString Error;
	if (!TestTrue(TEXT("load sample"), LoadProjectFile(Plugin->GetBaseDir() / TEXT("Resources/SampleProject.json"), Pr, Error)))
	{
		AddError(Error);
		return false;
	}
	const FPlan P = BuildPlan(Pr, FPlanSettings());
	TSet<FString> Roles;
	int32 FromCells = 0;
	for (const FBoxItem& B : P.Boxes)
	{
		Roles.Add(B.Role);
		FromCells += B.bFromVector ? 0 : 1;
	}
	TestTrue(TEXT("all roles"), Roles.Contains(TEXT("wall")) && Roles.Contains(TEXT("floor")) && Roles.Contains(TEXT("water")) && Roles.Contains(TEXT("hazard")));
	TestEqual(TEXT("levels"), P.LevelZ.Num(), 3);
	TestEqual(TEXT("icons"), P.Markers.Num(), 6);
	TestEqual(TEXT("filled ellipse mesh"), P.Meshes.Num(), 1);
	TestEqual(TEXT("no warnings"), P.Warnings.Num(), 0);
	for (const FString& W : P.Warnings)
	{
		AddInfo(W);
	}
	int32 Steps = 0;
	for (const FBoxItem& B : P.Boxes)
	{
		Steps += B.Role == TEXT("stairs") ? 1 : 0;
	}
	TestEqual(TEXT("one flight of 25 steps (stairs-up and stairs-down icons are the same stairs)"), Steps, 25);
	TestTrue(TEXT("water / hazard volumes"), P.Volumes.Num() >= 2);
	for (const FMarkerItem& M : P.Markers)
	{
		if (M.Kind == TEXT("door") || M.Kind.StartsWith(TEXT("stairs")))
		{
			TestTrue(FString::Printf(TEXT("%s built"), *M.Kind), M.bBuilt);
		}
	}
	TestEqual(TEXT("notes"), P.Notes.Num(), 1);
	TestTrue(TEXT("cells are merged"), FromCells < 60);
	const FMarkerItem* Chest = P.Markers.FindByPredicate([](const FMarkerItem& M) { return M.Kind == TEXT("chest"); });
	if (TestNotNull(TEXT("chest"), Chest))
	{
		TestEqual(TEXT("chest label"), Chest->Label, FString(TEXT("\u91D1\u94A5\u5319\u5B9D\u7BB1")));
	}
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FLevelLayoutSubtractTest, "LevelLayout.Plan.SubtractBox", LL_TEST_FLAGS)
bool FLevelLayoutSubtractTest::RunTest(const FString&)
{
	FBoxItem B;
	B.Role = TEXT("wall");
	B.Size = FVector(100, 100, 100);
	TArray<FBoxItem> Pieces;
	if (TestTrue(TEXT("cut through the middle"), SubtractBox(B, FVector::ZeroVector, FVector(50, 200, 200), 0, Pieces)))
	{
		TestEqual(TEXT("two halves left"), Pieces.Num(), 2);
		double Volume = 0;
		for (const FBoxItem& Piece : Pieces)
		{
			Volume += Piece.Size.X * Piece.Size.Y * Piece.Size.Z;
		}
		TestEqual(TEXT("volume left"), Volume, 500000.0, 1e-3);
	}
	TestTrue(TEXT("cut rotated 90 degrees"), SubtractBox(B, FVector(0, 0, 0), FVector(50, 200, 200), 90, Pieces) && Pieces.Num() == 2 && FMath::IsNearlyEqual(Pieces[0].Size.Y, 25.0));
	TestFalse(TEXT("45 degrees cannot be cut"), SubtractBox(B, FVector::ZeroVector, FVector(50, 50, 50), 45, Pieces));
	TestFalse(TEXT("no overlap"), SubtractBox(B, FVector(500, 0, 0), FVector(50, 50, 50), 0, Pieces));

	// A yawed wall: the pieces stay on its axis.
	FBoxItem R = B;
	R.Size = FVector(1000, 20, 400);
	R.Yaw = 30;
	R.Center = FVector(100, 200, 200);
	const FVector2D Dir(FMath::Cos(FMath::DegreesToRadians(30.0)), FMath::Sin(FMath::DegreesToRadians(30.0)));
	if (TestTrue(TEXT("cut a yawed wall"), SubtractBox(R, FVector(100, 200, 150), FVector(200, 40, 300), 30, Pieces)))
	{
		TestEqual(TEXT("left, right, lintel"), Pieces.Num(), 3);
		for (const FBoxItem& Piece : Pieces)
		{
			const FVector2D Off(Piece.Center.X - 100, Piece.Center.Y - 200);
			TestEqual(TEXT("piece on the wall axis"), FMath::Abs(Off.X * Dir.Y - Off.Y * Dir.X), 0.0, 1e-6);
		}
	}
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FLevelLayoutDoorTest, "LevelLayout.Plan.Doors", LL_TEST_FLAGS)
bool FLevelLayoutDoorTest::RunTest(const FString&)
{
	// A wall along Y (column 0, rows 0..9) with a door icon at row 5.
	FString CellsJson;
	for (int32 J = 0; J < 10; ++J)
	{
		CellsJson += (J ? TEXT(",") : TEXT("")) + Cell(0, 0, J, Wall);
	}
	const FString Json = FString::Printf(TEXT("{\"format\":\"level-layout-designer\",\"version\":5,\"legend\":[{\"name\":\"wall\",\"color\":\"%s\"}],")
		TEXT("\"floors\":[{\"level\":1,\"cells\":[%s],\"icons\":[{\"kind\":\"door\",\"x\":16,\"y\":160,\"size\":32},{\"kind\":\"locked\",\"x\":200,\"y\":200,\"size\":32}]}]}"),
		Wall, *CellsJson);
	FPlan P;
	if (!Plan(*this, Json, P))
	{
		return false;
	}
	TestEqual(TEXT("wall split into two pieces and a lintel"), P.Boxes.Num(), 3);
	bool bBlocked = false, bLintel = false;
	for (const FBoxItem& B : P.Boxes)
	{
		const FBox Bx(B.Center - B.Size / 2, B.Center + B.Size / 2);
		bBlocked |= Bx.IsInside(FVector(50, 500, 150));
		bLintel |= FMath::IsNearlyEqual(B.Size.Y, 200.0) && FMath::IsNearlyEqual(B.Size.Z, 100.0) && FMath::IsNearlyEqual(B.Center.Z, 350.0);
	}
	TestFalse(TEXT("opening is clear"), bBlocked);
	TestTrue(TEXT("lintel 2 m wide over a 3 m opening"), bLintel);
	TestTrue(TEXT("door built"), P.Markers[0].bBuilt);
	TestFalse(TEXT("locked door off the wall is not built"), P.Markers[1].bBuilt);
	TestEqual(TEXT("warning for the door off the wall"), P.Warnings.Num(), 1);
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FLevelLayoutStairsTest, "LevelLayout.Plan.Stairs", LL_TEST_FLAGS)
bool FLevelLayoutStairsTest::RunTest(const FString&)
{
	// 1F and 2F (5 m apart), 2F has a 10 x 10 m floor; stairs-up on 1F at (5 m, 5 m) going +X, stairs-down on 2F at the same place.
	const FString Json = FString::Printf(TEXT("{\"format\":\"level-layout-designer\",\"version\":5,\"legend\":[{\"name\":\"floor\",\"color\":\"%s\"}],\"floors\":[")
		TEXT("{\"level\":2,\"cells\":[%s],\"icons\":[{\"kind\":\"stairs-down\",\"x\":160,\"y\":160,\"rot\":180}]},")
		TEXT("{\"level\":1,\"icons\":[{\"kind\":\"stairs-up\",\"x\":160,\"y\":160,\"rot\":0}]}]}"),
		Floor, *Cell(1, 0, 0, Floor));
	FPlan P;
	if (!Plan(*this, Json, P))
	{
		return false;
	}
	TArray<const FBoxItem*> Steps;
	for (const FBoxItem& B : P.Boxes)
	{
		if (B.Role == TEXT("stairs"))
		{
			Steps.Add(&B);
		}
	}
	if (TestEqual(TEXT("one flight of 25 steps of 20 cm"), Steps.Num(), 25))
	{
		TestEqual(TEXT("first step center"), Steps[0]->Center.X, 500.0 - 375.0 + 15.0, 1e-6);
		TestEqual(TEXT("first step height"), Steps[0]->Size.Z, 20.0, 1e-6);
		TestEqual(TEXT("top step reaches 2F"), Steps.Last()->Center.Z + Steps.Last()->Size.Z / 2, 500.0, 1e-6);
		TestEqual(TEXT("stairs belong to 1F"), Steps[0]->Level, 1);
		TestEqual(TEXT("stairs width"), Steps[0]->Size.Y, 200.0, 1e-6);
	}
	bool bCovered = false;
	for (const FBoxItem& B : P.Boxes)
	{
		if (B.Level == 2)
		{
			const FBox Bx(B.Center - B.Size / 2, B.Center + B.Size / 2);
			bCovered |= Bx.IsInside(FVector(500, 500, 485)) || Bx.IsInside(FVector(800, 500, 485)) || Bx.IsInside(FVector(200, 550, 485));
		}
	}
	TestFalse(TEXT("2F floor is open over the stairs"), bCovered);
	for (const FMarkerItem& M : P.Markers)
	{
		TestTrue(TEXT("stairs icons built"), M.bBuilt);
	}
	TestEqual(TEXT("no warnings"), P.Warnings.Num(), 0);
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FLevelLayoutVolumesTest, "LevelLayout.Plan.Volumes", LL_TEST_FLAGS)
bool FLevelLayoutVolumesTest::RunTest(const FString&)
{
	const FString Json = TEXT("{\"format\":\"level-layout-designer\",\"version\":5,\"legend\":[{\"name\":\"w\",\"color\":\"#3f8fd8\",\"role\":\"water\"}],")
		TEXT("\"floors\":[{\"level\":1,\"cells\":[{\"k\":0,\"i\":0,\"j\":0,\"color\":\"#3f8fd8\"},{\"k\":0,\"i\":1,\"j\":0,\"color\":\"#3f8fd8\"}]}]}");
	FPlan P;
	if (Plan(*this, Json, P) && TestEqual(TEXT("one water volume"), P.Volumes.Num(), 1))
	{
		const FVolumeItem& V = P.Volumes[0];
		TestEqual(TEXT("volume role"), V.Role, FString(TEXT("water")));
		TestEqual(TEXT("volume footprint"), V.Size.X, 200.0, 1e-6);
		TestEqual(TEXT("volume top 1 m over the floor"), V.Center.Z + V.Size.Z / 2, 100.0, 1e-6);
		TestEqual(TEXT("volume bottom at the slab bottom"), V.Center.Z - V.Size.Z / 2, -40.0, 1e-6);
	}
	return true;
}

#undef LL_TEST_FLAGS

#endif

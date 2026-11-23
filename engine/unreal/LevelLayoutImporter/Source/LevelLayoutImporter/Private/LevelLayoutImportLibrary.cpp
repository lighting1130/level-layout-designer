// Level Layout Importer - MIT License

#include "LevelLayoutImportLibrary.h"

#include "LayoutPlan.h"
#include "LayoutSceneBuilder.h"
#include "LevelLayoutImporterSettings.h"
#include "LevelLayoutLog.h"

#include "Editor.h"
#include "Engine/World.h"
#include "ScopedTransaction.h"

#define LOCTEXT_NAMESPACE "LevelLayoutImporter"

static UWorld* GetEditorWorld(FString& OutError)
{
	if (!GEditor)
	{
		OutError = TEXT("Level Layout import only works in the editor.");
		return nullptr;
	}
	if (GEditor->PlayWorld || GEditor->bIsSimulatingInEditor)
	{
		OutError = TEXT("Stop Play In Editor before importing a level layout.");
		return nullptr;
	}
	UWorld* World = GEditor->GetEditorWorldContext().World();
	if (!World || !World->GetCurrentLevel())
	{
		OutError = TEXT("No level is open.");
		return nullptr;
	}
	return World;
}

FLevelLayoutImportResult ULevelLayoutImportLibrary::ImportLevelLayout(const FLevelLayoutImportOptions& Options)
{
	FLevelLayoutImportResult Result;
	auto Fail = [&Result](const FString& Error)
	{
		Result.bSuccess = false;
		Result.Error = Error;
		UE_LOG(LogLevelLayout, Error, TEXT("%s"), *Error);
		return Result;
	};

	UWorld* World = GetEditorWorld(Result.Error);
	if (!World)
	{
		return Fail(Result.Error);
	}
	if (Options.FilePath.IsEmpty())
	{
		return Fail(TEXT("No project file was given."));
	}

	LevelLayout::FProject Project;
	FString Error;
	if (!LevelLayout::LoadProjectFile(Options.FilePath, Project, Error))
	{
		return Fail(Error);
	}

	LevelLayout::FPlanSettings Settings;
	Settings.WallHeightM = Options.WallHeight;
	Settings.FloorHeightM = Options.FloorHeight;
	Settings.FloorThicknessM = Options.FloorThickness;
	Settings.LiquidDepthM = Options.LiquidDepth;
	Settings.Levels = Options.Levels;
	Settings.bCutDoors = Options.bCutDoors;
	Settings.DoorWidthM = Options.DoorWidth;
	Settings.DoorHeightM = Options.DoorHeight;
	Settings.bBuildStairs = Options.bBuildStairs;
	Settings.StairWidthM = Options.StairWidth;
	Settings.StairMaxRiserM = Options.StairMaxStepHeight;
	Settings.StairTreadM = Options.StairStepDepth;
	const LevelLayout::FPlan Plan = LevelLayout::BuildPlan(Project, Settings);
	Result.ProjectName = Plan.Name;
	Result.Warnings = Plan.Warnings;
	if (Plan.Boxes.Num() + Plan.Meshes.Num() + Plan.Markers.Num() + Plan.Notes.Num() == 0)
	{
		return Fail(Options.Levels.Num() > 0
			? TEXT("Nothing to import: the selected levels are empty or not in the file.")
			: TEXT("Nothing to import: the project has no walls, floors, icons or notes."));
	}

	{
		FScopedTransaction Transaction(FText::Format(LOCTEXT("ImportTransaction", "Import Level Layout: {0}"), FText::FromString(Plan.Name)));
		LevelLayout::FSceneBuilder Builder(World, Plan, Options, Result);
		if (!Builder.Run())
		{
			Transaction.Cancel();
			return Fail(Result.Error);
		}
	}
	Result.bSuccess = true;

	UE_LOG(LogLevelLayout, Log, TEXT("Imported %s (1 cell = %g m, backend %s): %d boxes, %d meshes, %d volumes, %d icons, %d notes; removed %d actors from the previous import."),
		*Plan.Name, Plan.MetersPerCell, *Result.BackendUsed, Result.NumBoxes, Result.NumMeshes, Result.NumVolumes, Result.NumMarkers, Result.NumNotes, Result.NumRemoved);
	for (const FString& W : Result.Warnings)
	{
		UE_LOG(LogLevelLayout, Warning, TEXT("%s"), *W);
	}
	if (GEditor)
	{
		GEditor->RedrawLevelEditingViewports();
	}
	return Result;
}

FLevelLayoutImportOptions ULevelLayoutImportLibrary::GetDefaultImportOptions(const FString& FilePath)
{
	FLevelLayoutImportOptions Options = GetDefault<ULevelLayoutImporterSettings>()->DefaultOptions;
	Options.FilePath = FilePath;
	return Options;
}

int32 ULevelLayoutImportLibrary::RemoveImportedActors(const FString& ProjectName)
{
	FString Error;
	UWorld* World = GetEditorWorld(Error);
	if (!World)
	{
		UE_LOG(LogLevelLayout, Error, TEXT("%s"), *Error);
		return 0;
	}
	FScopedTransaction Transaction(LOCTEXT("RemoveTransaction", "Remove Level Layout Blockout"));
	const FName Tag = ProjectName.IsEmpty() ? NAME_None : LevelLayout::ProjectTag(LevelLayout::SafeName(ProjectName));
	const int32 N = LevelLayout::RemoveActorsWithTag(World, Tag);
	if (N == 0)
	{
		Transaction.Cancel();
	}
	return N;
}

#undef LOCTEXT_NAMESPACE

// Level Layout Importer - MIT License

#include "LevelLayoutImportDialog.h"
#include "LevelLayoutImportLibrary.h"
#include "LevelLayoutImporterSettings.h"
#include "LevelLayoutLog.h"

#include "DesktopPlatformModule.h"
#include "EditorDirectories.h"
#include "Framework/Application/SlateApplication.h"
#include "Framework/Notifications/NotificationManager.h"
#include "HAL/IConsoleManager.h"
#include "IDesktopPlatform.h"
#include "Misc/MessageDialog.h"
#include "Misc/Paths.h"
#include "Modules/ModuleManager.h"
#include "Styling/AppStyle.h"
#include "ToolMenus.h"
#include "Widgets/Notifications/SNotificationList.h"

#define LOCTEXT_NAMESPACE "LevelLayoutImporter"

DEFINE_LOG_CATEGORY(LogLevelLayout);

namespace
{
	/** Options from the last dialog in this editor session. */
	TOptional<FLevelLayoutImportOptions> GLastOptions;

	void ReportResult(const FLevelLayoutImportResult& Result)
	{
		if (!Result.bSuccess)
		{
			FMessageDialog::Open(EAppMsgType::Ok, FText::Format(LOCTEXT("ImportFailed", "Level Layout import failed:\n\n{0}"), FText::FromString(Result.Error)));
			return;
		}
		FString Text = FString::Printf(TEXT("Imported %s: %d boxes, %d meshes, %d volumes, %d icons, %d notes (%s)."),
			*Result.ProjectName, Result.NumBoxes, Result.NumMeshes, Result.NumVolumes, Result.NumMarkers, Result.NumNotes, *Result.BackendUsed);
		if (Result.NumRemoved > 0)
		{
			Text += FString::Printf(TEXT("\nReplaced %d actors from the previous import."), Result.NumRemoved);
		}
		FNotificationInfo Info(FText::FromString(Text));
		Info.ExpireDuration = 6.0f;
		Info.bUseSuccessFailIcons = true;
		if (Result.Warnings.Num() > 0)
		{
			Info.SubText = FText::FromString(FString::Join(Result.Warnings, TEXT("\n")));
			Info.ExpireDuration = 12.0f;
		}
		TSharedPtr<SNotificationItem> Item = FSlateNotificationManager::Get().AddNotification(Info);
		if (Item.IsValid())
		{
			Item->SetCompletionState(Result.Warnings.Num() > 0 ? SNotificationItem::CS_None : SNotificationItem::CS_Success);
		}
	}

	void OpenImportDialog()
	{
		IDesktopPlatform* Desktop = FDesktopPlatformModule::Get();
		if (!Desktop)
		{
			return;
		}
		TArray<FString> Files;
		const void* Parent = FSlateApplication::Get().FindBestParentWindowHandleForDialogs(nullptr);
		const FString LastDir = FEditorDirectories::Get().GetLastDirectory(ELastDirectory::GENERIC_IMPORT);
		if (!Desktop->OpenFileDialog(Parent, LOCTEXT("PickFile", "Choose a Level Layout project file").ToString(), LastDir, TEXT(""),
				TEXT("Level Layout project (*.json)|*.json"), EFileDialogFlags::None, Files) || Files.Num() == 0)
		{
			return;
		}
		const FString Path = FPaths::ConvertRelativePathToFull(Files[0]);
		FEditorDirectories::Get().SetLastDirectory(ELastDirectory::GENERIC_IMPORT, FPaths::GetPath(Path));

		FLevelLayoutImportOptions Options = GLastOptions.IsSet() ? GLastOptions.GetValue() : ULevelLayoutImportLibrary::GetDefaultImportOptions(Path);
		if (!SLevelLayoutImportDialog::Open(Path, Options))
		{
			return;
		}
		GLastOptions = Options;
		ReportResult(ULevelLayoutImportLibrary::ImportLevelLayout(Options));
	}

	/**
	 * LevelLayout.Import <file.json> [backend=auto|blockout|cube] [levels=1,-1] [wall=4] [floor=5] [keep] [nonav] [nodoors] [nostairs] [novolumes]
	 * For scripts and -ExecCmds; the result goes to the log (LogLevelLayout).
	 */
	void ImportCommand(const TArray<FString>& Args)
	{
		if (Args.Num() == 0)
		{
			UE_LOG(LogLevelLayout, Display, TEXT("Usage: LevelLayout.Import <file.json> [backend=auto|blockout|cube] [levels=1,-1] [wall=4] [floor=5] [keep] [nonav] [nodoors] [nostairs] [novolumes]"));
			return;
		}
		FLevelLayoutImportOptions Options = ULevelLayoutImportLibrary::GetDefaultImportOptions(Args[0].TrimQuotes());
		for (int32 N = 1; N < Args.Num(); ++N)
		{
			FString Key, Value;
			if (!Args[N].Split(TEXT("="), &Key, &Value))
			{
				Key = Args[N];
			}
			Key.ToLowerInline();
			if (Key == TEXT("backend"))
			{
				Value.ToLowerInline();
				Options.Backend = Value == TEXT("cube") ? ELevelLayoutBackend::Cube : Value == TEXT("blockout") ? ELevelLayoutBackend::Blockout : ELevelLayoutBackend::Auto;
			}
			else if (Key == TEXT("levels"))
			{
				TArray<FString> Parts;
				Value.ParseIntoArray(Parts, TEXT(","));
				Options.Levels.Reset();
				for (const FString& P : Parts)
				{
					Options.Levels.Add(FCString::Atoi(*P));
				}
			}
			else if (Key == TEXT("wall"))
			{
				Options.WallHeight = FCString::Atof(*Value);
			}
			else if (Key == TEXT("floor"))
			{
				Options.FloorHeight = FCString::Atof(*Value);
			}
			else if (Key == TEXT("keep"))
			{
				Options.bReplacePrevious = false;
			}
			else if (Key == TEXT("nonav"))
			{
				Options.bAddNavMeshBounds = false;
			}
			else if (Key == TEXT("nodoors"))
			{
				Options.bCutDoors = false;
			}
			else if (Key == TEXT("nostairs"))
			{
				Options.bBuildStairs = false;
			}
			else if (Key == TEXT("novolumes"))
			{
				Options.bAddVolumes = false;
			}
			else
			{
				UE_LOG(LogLevelLayout, Warning, TEXT("Unknown argument: %s"), *Args[N]);
			}
		}
		const FLevelLayoutImportResult Result = ULevelLayoutImportLibrary::ImportLevelLayout(Options);
		UE_LOG(LogLevelLayout, Display, TEXT("LevelLayout.Import result: success=%d backend=%s boxes=%d meshes=%d volumes=%d icons=%d notes=%d removed=%d warnings=%d"),
			Result.bSuccess ? 1 : 0, *Result.BackendUsed, Result.NumBoxes, Result.NumMeshes, Result.NumVolumes, Result.NumMarkers, Result.NumNotes, Result.NumRemoved, Result.Warnings.Num());
	}

	FAutoConsoleCommand GImportCommand(
		TEXT("LevelLayout.Import"),
		TEXT("Import a Level Layout Designer project: LevelLayout.Import <file.json> [backend=auto|blockout|cube] [levels=1,-1] [wall=4] [floor=5] [keep] [nonav] [nodoors] [nostairs] [novolumes]"),
		FConsoleCommandWithArgsDelegate::CreateStatic(&ImportCommand));

	FAutoConsoleCommand GRemoveCommand(
		TEXT("LevelLayout.Remove"),
		TEXT("Delete the actors generated by Level Layout imports: LevelLayout.Remove [project name]"),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const int32 N = ULevelLayoutImportLibrary::RemoveImportedActors(Args.Num() > 0 ? FString::Join(Args, TEXT(" ")) : FString());
			UE_LOG(LogLevelLayout, Display, TEXT("Removed %d Level Layout actors."), N);
		}));
}

class FLevelLayoutImporterModule : public IModuleInterface
{
public:
	virtual void StartupModule() override
	{
		UToolMenus::RegisterStartupCallback(FSimpleMulticastDelegate::FDelegate::CreateRaw(this, &FLevelLayoutImporterModule::RegisterMenus));
	}

	virtual void ShutdownModule() override
	{
		UToolMenus::UnRegisterStartupCallback(this);
		UToolMenus::UnregisterOwner(this);
	}

private:
	void RegisterMenus()
	{
		FToolMenuOwnerScoped OwnerScoped(this);
		UToolMenu* Menu = UToolMenus::Get()->ExtendMenu("LevelEditor.MainMenu.Tools");
		FToolMenuSection& Section = Menu->FindOrAddSection("LevelLayout", LOCTEXT("MenuSection", "Level Layout"));
		Section.AddMenuEntry(
			"ImportLevelLayout",
			LOCTEXT("MenuEntry", "Import Level Layout..."),
			LOCTEXT("MenuTooltip", "Generate a same-scale blockout in the current level from a Level Layout Designer project file (.json)."),
			FSlateIcon(FAppStyle::GetAppStyleSetName(), "Icons.Import"),
			FUIAction(FExecuteAction::CreateStatic(&OpenImportDialog)));
	}
};

IMPLEMENT_MODULE(FLevelLayoutImporterModule, LevelLayoutImporter)

#undef LOCTEXT_NAMESPACE

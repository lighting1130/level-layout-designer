// Level Layout Importer - MIT License

#include "LevelLayoutImportDialog.h"

#include "Framework/Application/SlateApplication.h"
#include "Framework/Docking/TabManager.h"
#include "IDetailsView.h"
#include "Misc/Paths.h"
#include "Modules/ModuleManager.h"
#include "PropertyEditorModule.h"
#include "Styling/AppStyle.h"
#include "UObject/StrongObjectPtr.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SWindow.h"
#include "Widgets/Text/STextBlock.h"

#define LOCTEXT_NAMESPACE "LevelLayoutImporter"

void SLevelLayoutImportDialog::Construct(const FArguments& InArgs)
{
	Window = InArgs._Window;

	FPropertyEditorModule& PropertyEditor = FModuleManager::LoadModuleChecked<FPropertyEditorModule>("PropertyEditor");
	FDetailsViewArgs Args;
	Args.bAllowSearch = false;
	Args.bHideSelectionTip = true;
	Args.NameAreaSettings = FDetailsViewArgs::HideNameArea;
	Args.bShowOptions = false;
	DetailsView = PropertyEditor.CreateDetailView(Args);
	DetailsView->SetObject(InArgs._Options);

	ChildSlot
	[
		SNew(SBorder)
		.BorderImage(FAppStyle::GetBrush("ToolPanel.GroupBorder"))
		.Padding(8)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 8)
			[
				SNew(STextBlock)
				.Text(FText::Format(LOCTEXT("FileLabel", "Project file: {0}"), FText::FromString(FPaths::GetCleanFilename(InArgs._FilePath))))
				.ToolTipText(FText::FromString(InArgs._FilePath))
			]
			+ SVerticalBox::Slot().FillHeight(1)
			[
				DetailsView.ToSharedRef()
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right).Padding(0, 8, 0, 0)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().Padding(0, 0, 8, 0)
				[
					SNew(SButton)
					.ButtonStyle(FAppStyle::Get(), "PrimaryButton")
					.Text(LOCTEXT("Import", "Import"))
					.OnClicked(this, &SLevelLayoutImportDialog::OnImport)
				]
				+ SHorizontalBox::Slot().AutoWidth()
				[
					SNew(SButton)
					.Text(LOCTEXT("Cancel", "Cancel"))
					.OnClicked(this, &SLevelLayoutImportDialog::OnCancel)
				]
			]
		]
	];
}

FReply SLevelLayoutImportDialog::OnImport()
{
	bImport = true;
	if (TSharedPtr<SWindow> W = Window.Pin())
	{
		W->RequestDestroyWindow();
	}
	return FReply::Handled();
}

FReply SLevelLayoutImportDialog::OnCancel()
{
	bImport = false;
	if (TSharedPtr<SWindow> W = Window.Pin())
	{
		W->RequestDestroyWindow();
	}
	return FReply::Handled();
}

bool SLevelLayoutImportDialog::Open(const FString& FilePath, FLevelLayoutImportOptions& InOutOptions)
{
	TStrongObjectPtr<ULevelLayoutImportDialogOptions> Holder(NewObject<ULevelLayoutImportDialogOptions>());
	Holder->Options = InOutOptions;

	TSharedRef<SWindow> Win = SNew(SWindow)
		.Title(LOCTEXT("DialogTitle", "Import Level Layout"))
		.ClientSize(FVector2D(520, 600))
		.SupportsMinimize(false)
		.SupportsMaximize(false);
	TSharedPtr<SLevelLayoutImportDialog> Dialog;
	Win->SetContent(SAssignNew(Dialog, SLevelLayoutImportDialog).Window(Win).Options(Holder.Get()).FilePath(FilePath));
	FSlateApplication::Get().AddModalWindow(Win, FGlobalTabmanager::Get()->GetRootWindow());

	if (!Dialog->ShouldImport())
	{
		return false;
	}
	InOutOptions = Holder->Options;
	InOutOptions.FilePath = FilePath;
	return true;
}

#undef LOCTEXT_NAMESPACE

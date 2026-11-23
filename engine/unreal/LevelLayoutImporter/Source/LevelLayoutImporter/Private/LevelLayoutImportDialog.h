// Level Layout Importer - MIT License

#pragma once

#include "CoreMinimal.h"
#include "LevelLayoutTypes.h"
#include "UObject/Object.h"
#include "Widgets/SCompoundWidget.h"
#include "LevelLayoutImportDialog.generated.h"

class IDetailsView;
class SWindow;

/** Holder so the import options can be edited in a details view. */
UCLASS(Transient)
class ULevelLayoutImportDialogOptions : public UObject
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, Category = "Import", meta = (ShowOnlyInnerProperties))
	FLevelLayoutImportOptions Options;
};

/** Import options with Import / Cancel buttons. */
class SLevelLayoutImportDialog : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SLevelLayoutImportDialog) {}
		SLATE_ARGUMENT(TWeakPtr<SWindow>, Window)
		SLATE_ARGUMENT(ULevelLayoutImportDialogOptions*, Options)
		SLATE_ARGUMENT(FString, FilePath)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	bool ShouldImport() const { return bImport; }

	/** Show the dialog for a file; returns true and fills Options when the user pressed Import. */
	static bool Open(const FString& FilePath, FLevelLayoutImportOptions& InOutOptions);

private:
	FReply OnImport();
	FReply OnCancel();

	TWeakPtr<SWindow> Window;
	TSharedPtr<IDetailsView> DetailsView;
	bool bImport = false;
};

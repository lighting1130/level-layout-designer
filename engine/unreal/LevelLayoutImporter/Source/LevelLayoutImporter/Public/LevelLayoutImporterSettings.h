// Level Layout Importer - MIT License

#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "LevelLayoutTypes.h"
#include "LevelLayoutImporterSettings.generated.h"

/** Project Settings > Plugins > Level Layout Importer. */
UCLASS(Config = Editor, DefaultConfig, meta = (DisplayName = "Level Layout Importer"))
class LEVELLAYOUTIMPORTER_API ULevelLayoutImporterSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	ULevelLayoutImporterSettings();

	virtual FName GetCategoryName() const override { return TEXT("Plugins"); }

	/** Defaults shown in the import dialog (the file path is ignored). */
	UPROPERTY(Config, EditAnywhere, Category = "Defaults")
	FLevelLayoutImportOptions DefaultOptions;

	/**
	 * Actor class to spawn for an icon kind, e.g. "enemy" -> your enemy spawner blueprint, "chest" -> your chest.
	 * Built-in kinds: stairs-up, stairs-down, ladder, door, locked, key, chest, trap, save, spawn, goal, boss, enemy,
	 * npc, shop, heal, item, switch, teleport, danger, camera. Icons without a mapping get a labeled placeholder
	 * (spawn -> PlayerStart, camera -> CameraActor).
	 */
	UPROPERTY(Config, EditAnywhere, Category = "Icons")
	TMap<FString, TSoftClassPtr<AActor>> IconActorClasses;

	/** Blueprint used for boxes when Blockout Tools is enabled. */
	UPROPERTY(Config, EditAnywhere, Category = "Blockout Tools", meta = (MetaClass = "/Script/Engine.Actor"))
	FSoftClassPath BlockoutBoxClass;

	/** Grid size of the Blockout material = one cell of the web tool. */
	UPROPERTY(Config, EditAnywhere, Category = "Blockout Tools")
	bool bMatchGridToCell = true;
};

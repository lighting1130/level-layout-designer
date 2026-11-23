// Level Layout Importer - MIT License

using UnrealBuildTool;

public class LevelLayoutImporter : ModuleRules
{
	public LevelLayoutImporter(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"DeveloperSettings",
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"UnrealEd",
			"Slate",
			"SlateCore",
			"InputCore",
			"ToolMenus",
			"Json",
			"DesktopPlatform",
			"PropertyEditor",
			"AssetTools",
			"NavigationSystem",
			"Projects",
			"EditorSubsystem",
		});
	}
}

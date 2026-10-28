require 'xcodeproj'

root = File.expand_path(__dir__)
path = File.join(root, 'PortofolioProbe.xcodeproj')
abort('Project already exists; preserve it instead of overwriting.') if File.exist?(path)
project = Xcodeproj::Project.new(path)
target = project.new_target(:application, 'PortofolioProbe', :ios, '26.0')
sources = project.main_group.new_group('Sources', 'Sources')
Dir.glob(File.join(root, 'Sources', '*.swift')).sort.each do |file|
  next if File.basename(file) == 'ProbeProtocol.swift' # Preserved Probe 0.2 compatibility source.
  reference = sources.new_file(File.basename(file))
  target.source_build_phase.add_file_reference(reference)
end
local = project.new(Xcodeproj::Project::Object::XCLocalSwiftPackageReference)
local.relative_path = '../../packages/nearby-ios'
project.root_object.package_references << local
product = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
product.package = local
product.product_name = 'PortofolioNearby'
target.package_product_dependencies << product
build = project.new(Xcodeproj::Project::Object::PBXBuildFile)
build.product_ref = product
target.frameworks_build_phase.files << build
project.main_group.new_file('Info.plist')
target.build_configurations.each do |configuration|
  configuration.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'gr.portofolio.proximityprobe',
    'PRODUCT_NAME' => 'PortofolioProbe',
    'INFOPLIST_FILE' => 'Info.plist',
    'GENERATE_INFOPLIST_FILE' => 'NO',
    'SWIFT_VERSION' => '5.0',
    'TARGETED_DEVICE_FAMILY' => '1',
    'CODE_SIGN_STYLE' => 'Automatic',
    'SDKROOT' => 'iphoneos',
    'SUPPORTED_PLATFORMS' => 'iphoneos iphonesimulator',
    'IPHONEOS_DEPLOYMENT_TARGET' => '26.0',
    'ENABLE_USER_SCRIPT_SANDBOXING' => 'YES',
    'SWIFT_EMIT_LOC_STRINGS' => 'YES'
  })
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.set_launch_target(target)
scheme.save_as(project.path, target.name, true)
puts path

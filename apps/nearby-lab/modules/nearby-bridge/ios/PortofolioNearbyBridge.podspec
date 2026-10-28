Pod::Spec.new do |s|
  s.name = 'PortofolioNearbyBridge'
  s.version = '0.1.0'
  s.summary = 'Portofolio isolated nearby exposure experiment'
  s.description = s.summary
  s.author = 'Pegasoft'
  s.license = { :type => 'UNLICENSED' }
  s.homepage = 'https://pegasoft.ai'
  s.source = { :path => '.' }
  s.platforms = { :ios => '26.0' }
  s.swift_version = '5.0'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## 0.1.0

### Added

- Automatically create build tasks based on the targets in a package.
- Show package dependencies in the Explorer.
- Add button to package dependencies view to update packages.
- Resolve dependencies when **Package.swift** or **Package.resolved** changes.
- Integrated with Soucekit-LSP.
- Generate launch configurations for each executable and tests in **Package.swift**.
- Added "Swift" output channel providing a history of all actions.
- Add status bar item for when swift resolve or updates are running.
- Bundle using ESBuild.
- Add configuration parameter `path` to define where swift is found.
- Add configuration parameter `buildArguments` to add custom build arguments.
- Configure CoreLLDB to work with Swift.

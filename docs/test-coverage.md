# Test Coverage

Test coverage is a measurement of how much of your code is tested by your tests. It defines how many lines of code were actually run when you ran your tests and how many were not. When a line of code is not run by your tests it will not have been tested and perhaps you need to extend your tests.

The Swift extension has an option to run your tests and record what code has been hit or missed by your tests.

![](images/coverage-run.png)

Once this is run an overview report will be displayed listing all the source files in your project and how many lines were hit by tests, how many lines were missed, how lines of source code there is in total and a percentage of those that were hit. You can click on each file to open that file in Visual Studio Code. If you close the report you can always get it back by running the command `Show Test Coverage Report`. There is also a setting `Coverage: Display Report after Run` to control whether the test coverage report is shown immediately after running tests.

![](images/coverage-report.png)

If you would like a more detailed view of the results there is a command `Toggle Display of Test Coverage Results` to toggle an in editor view of the coverage results. This will color the background of hit and missed lines of code with different colours. By default a hit line of code gets a green background and a missed line get a red background, although these are editable in the settings. 

![](images/coverage-render.png)

An additional UI status item is displayed in the status bar at the bottom of the screen showing the hit percentage for the currently open file. This status item can be set to be always visible or only when coverage information is available. If you have it set to be visible all the time it can be used as a button to toggle the display of the in editor coverage results.  


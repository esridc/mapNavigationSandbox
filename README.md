# mapNavigationSandbox
Experiments with map navigation.

Demo here:
http://esridc.github.io/mapNavigationSandbox/sonar.html

This demo shows some experimental keyboard navigation methods. The "keyboard mode menu" will appear if the <kbd>Tab</kbd> key is used to move focus to the map.

**Feature Selection Mode:**
- <kbd>Tab</kbd> to step forward through the features in the current viewport, sorted by longitude.
- <kbd>Shift-Tab</kbd> to step backwards.
- <kbd>Enter</kbd> to enter Feature Mode for a selected feature.
- <kbd>c</kbd> to center the map on the selected feature.
- Screen readers will announce the title of each feature's popup.

**Feature Mode:**
- <kbd>Tab</kbd> to step through the elements of a feature popup. Screen readers will read the contents of each feature.
- <kbd>Shift-Tab</kbd> to step backwards.
- <kbd>Esc</kbd> to exit the popup and return to Feature Selection Mode.

**Verbose:**
This mode will perform a reverse-geocode on every map navigation, and find the general region of the current map view when available. Screen readers will announce the region when the region changes.

**Sonar:**
This mode will perform a "sonar ping" on every map navigation, which converts the position of every feature in the current view to a time and pitch, and will play the resulting chord. Reverb is added to the chord at low zoom levels.

**Global keys:**
- <kbd>s</kbd> will perform a "sonar ping".
- <kbd>z</kbd> will zoom in two zoom levels.
- <kbd>x</kbd> will zoom out two zoom levels.
- <kbd>numkeys</kbd> will zoom to the specified key's zoom level.

**Other behavior:**

Screen readers will announce the new interaction mode when it changes.

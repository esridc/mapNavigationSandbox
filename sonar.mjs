import { loadModules, setDefaultOptions } from 'https://unpkg.com/esri-loader/dist/esm/esri-loader.js';
// import { default as sound } from '/sound.js';

(async () => {

  setDefaultOptions({
    css: true,
    // url: 'http://localhost:8000/buildOutput/init.js',
    // url: 'http://jscore.esri.com/debug/4.16/dojo/dojo.js',
    // version: 'next',
  });

  const [
  Map,
  MapView,
  FeatureLayer,
  esriRequest,
  webMercatorUtils,
  watchUtils,
  Point,
] = await loadModules([
  "esri/Map",
  "esri/views/MapView",
  "esri/layers/FeatureLayer",
  "esri/request",
  "esri/geometry/support/webMercatorUtils",
  "esri/core/watchUtils",
  "esri/geometry/Point",
]);

  // track state + global settings
  var state = {};
  var keyboardModeState = {};
  var globals = {};
  function initState() {
    state = {
      dataset: null,
      layer: null,
      view: null,
      widgets: [],
      legend: null,
      categoricalMax: 7,
      fieldName: null,
      lastPosition: {x: 0, y: 0, z: 0},
    }
    keyboardModeState = {
      features: null,
      feature: null,
      featureIndex: 0,
      mode: null,
      place: null,
      sonar: null,
      verbose: null,
      lastPlace: null,
    };
    globals = {
      numPitches: 25,
      numNotes: 30,
      notes: null,
      singlePart: null,
    }
  }

  var highlight = null;

  //
  // UTILITY FUNCTIONS
  //

  // draw whole map from scratch
  async function drawMap() {
    var {dataset, layer, view} = state;
    const map = new Map({
      // choose a light or dark background theme as default
      basemap: "gray-vector",
      layers: layer,
    });
    if (view) {
      // update existing view, then exit
      view.map = map;
      state = {...state, view}
    }
    var view = new MapView({
      container: "viewDiv",
      map: map,
      extent: getDatasetExtent(dataset),
      ui: { components: [] },
      highlightOptions: {
        color: [0, 255, 255],
        fillOpacity: 0.6
      },
    });

    // spinner
    // only show on first page load
    let loadedOnce = false;
    view.watch('updating', function(evt){
      if (loadedOnce) return false;
      // if (!evt) document.getElementById('base-loader').style.display = 'none';
      loadedOnce = true;
    });

    view.goTo({
      center: [-5, 40],
      zoom: 5,
    })

    // update features when the view is moved
    watchUtils.whenTrue(view, "stationary", function() {
      let { lastPosition } = state;
      // Get the new center of the view only when view becomes stationary.
      if ( view.extent.center.x == lastPosition.x &&
          view.extent.center.y == lastPosition.y &&
          view.zoom == lastPosition.z
      ) {
        // nothing moved
        return false
      }
      updateFeatures();
    });


    // put vars on window for debugging
    Object.assign(window, { state, map, keyboardModeState, globals });

    // Dataset info
    // document.querySelector('#datasetName').innerHTML = dataset.attributes.name;
    // document.querySelector('#orgName').innerHTML = dataset.attributes.orgName || '';
    // document.querySelector('#recordCount').innerHTML = `${dataset.attributes.recordCount} records`;

    // update state
    state.view = view;
    return view;
  }


  async function loadDataset (args) {
    // reset state
    initState();
    var dataset, layer;
    // load dataset metadata locally – this is much faster than hitting the arcgis servers
    const datasetURL = '8581a7460e144ae09ad25d47f8e82af8_0.json';
    try {
      // dataset: https://services8.arcgis.com/iSk8OjfdllV32jzx/arcgis/rest/services/Citclops_Export_EC2020/FeatureServer
      dataset = (await fetch(datasetURL).then(r => {
        console.log('LOADED');
        document.getElementById('base-loader').style.display = 'none';
        return r.json();
      })).data;
    } catch(e) { console.log('failed to load dataset', e); }
    // initialize a new layer
    const url = dataset.attributes.url;
    layer = new FeatureLayer({
      renderer: {type: 'simple'},
      url,
      minScale: 0,
      maxScale: 0,
    });
    layer.popupTemplate = {
      title: "To use this map:",
      content: `Click "Feature selection" in the menu, then use "Tab" and "Shift-Tab" to move forward and back, and "Enter" and "esc" to move into and out of features. Check "Verbose" for more detailed announcements, "Sonar" for musical feedback, and "Help" for more information.`
    }
    layer.onclick = null;

    // update state
    state = {...state, layer, dataset};

    // draw map once before autoStyling to initialize layerView object
    state.view = await drawMap();
    setStyles({});  // style the map

    // keyboard mode on by default (was previously only active if you tabbed into the map)
    setKeyboardMode(true);
    // show help every time the page loads
    // setMode('help')
  }

  //
  // STYLING
  //

  // set symbology
  async function setStyles () {
    var {layer, view} = state;

    // SET COLORS

    var fillColor = [173,216,230,255]; // lightblue
    var strokeColor = [70,130,180,255]; // steelblue

    var renderer = {
      type: "simple", // autocasts as new SimpleRenderer()
      visualVariables: [],
    };

    var symbol = {
      type: 'simple-marker',
      size: '9px',
      color: fillColor,
      outline: {
        color: strokeColor,
        width: '.5px'
      }
    };

    renderer = {...renderer, symbol};

    layer.renderer = renderer; // replace the old renderer
    layer.refresh(); // ensure the layer draws

    // update state
    state = {...state, layer, view, renderer}
  } // end setStyles


  //
  // STYLING UTILITY FUNCTIONS
  //

  // get geometrical extent of dataset features
  function getDatasetExtent (dataset) {
    const extent = dataset.attributes.extent;
    return {
      xmin: extent.coordinates[0][0],
      ymin: extent.coordinates[0][1],
      xmax: extent.coordinates[1][0],
      ymax: extent.coordinates[1][1],
      spatialReference: extent.spatialReference
    };
  }

  //
  // KEYBOARD NAVIGATION MODE
  //

  function initKeyboardMode() {
    // bind events for keyboard mode menu options
    document.querySelector('#featureSelectionModeButton').addEventListener('click', (e) => {
      setMode("featureSelection");
      selectFeature();
    });
    document.querySelector('#featureModeButton').addEventListener('click', (e) => {
      selectFeature().then(() => activateFeatureMode());
      document.querySelector("#popup-content>#placeLabel").focus();
    });
    document.querySelector('#verboseCheckbox').addEventListener('click', (e) => {
      // toggle verbose
      if (e.currentTarget.checked) {
        keyboardModeState.verbose = true;
        updateFeatures();
        announceRegion();
      }
      else {
        keyboardModeState.verbose = false;
      }
    });
    document.querySelector('#sonarModeCheckbox').addEventListener('change', (e) => {
      // toggle sound
      if (e.currentTarget.checked) {
        sonarSetup();
        ping();
      }
      else Tone.Transport.stop()
    });
    document.querySelector('#helpButton').addEventListener('click', (e) => {
      if (e.currentTarget.checked) {
        setMode("help");
      }
      else {
        setMode("menu");
      }
    });
  }

  function setMode(mode) {
    keyboardModeState.mode = mode;
    document.querySelector('#featureSelectionModeButton').checked = mode == "featureSelection" ? true : false;
    document.querySelector('#featureModeButton').checked = mode == "feature" ? true : false;
    document.querySelector('#helpButton').checked = mode == "help" ? true : false;
    document.querySelector('#helpDivWrapper').style.display = mode == "help" ? "flex" : "none";
    modeStatus(mode);
  }

  async function setKeyboardMode(value) {
    let { view } = state;

    const keyboardMenu = document.querySelector('#keyboardModeMenu');
    if (value) { // keyboard mode on
      // show keyboard mode menu
      // (always on for now)
      // keyboardMenu.classList.remove("hidden");
      // statusAlert('KeyboardMode on.');
      // document.activeElement.blur();
      // keyboardMenu.focus();


      window.addEventListener('keydown', keyboardModeHandler);
      if (!view) {
        view = await drawMap();
      }

      // updateFeatures();

      // keyboard mode always on for now
    // } else if (!value) { // keyboard mode off
    //   statusAlert('KeyboardMode off.');
    //   // hide keyboard mode menu
    //   // state.view.ui.remove('keyboardModeMenu');
    //   setMode(null)
    //   state.view.popup.close();
    //   window.removeEventListener('keydown', keyboardModeHandler);
    //   keyboardMenu.classList.add("hidden");
    }
  }

  async function updateFeatures() {
    let {view, layer} = state;
    if (!view) return false;
    // query visible features
    var query = layer.createQuery();
    query.geometry = view.extent;
    // query.spatialRelationship = "intersects";
    query.spatialRelationship = "contains"; // this might work better?

    var features = (await state.layer.queryFeatures(query)).features;
    // sort so tab order goes from west to east onscreen
    features.sort((a, b) => (a.geometry.longitude > b.geometry.longitude) ? 1 : -1);
    keyboardModeState.features = features;

    state.lastPosition = {
      x: view.extent.center.x,
      y: view.extent.center.y,
      z: view.zoom
    }

    if (keyboardModeState.sonar) {
      ping()
    }

    if (keyboardModeState.verbose) {
      announceRegion()
    }

  }

  // mode event handler
  // dedicated to Larry Tesler
  function keyboardModeHandler(e) {
    let { mode } = keyboardModeState;

    // pass event to the current mode's keyhandler
    if (mode == "menu") menuHandler(e);
    else if (mode == "featureSelection") featureSelectionHandler(e);
    else if (mode == "feature") featureHandler(e);
    else if (mode == "help") helpHandler(e);
  }

  // main keyboardMode menu
  function menuHandler(e) {
    if (e.key == "Escape") {
      setKeyboardMode(false);
    }
  }

  // featureSelection mode
  function featureSelectionHandler(e) {
    var { feature, features, featureIndex, mode } = keyboardModeState;
    if (e.key == "Tab") {
      // if the keyboardMode map div is not selected, there has been mouse interaction -
      // move focus to the context div and select the last selected feature
      // if (document.activeElement != null) {
      //   return;
      //   // return e.preventDefault();
      // }

      // Shift-Tab: move backward through the series
      if (e.shiftKey) {
        // if no feature selected, or the first feature is selected, select the last feature
        if (featureIndex == 0) {
          selectFeature(features.length - 1);
        }
        // if a feature is selected, select the previous feature
        else {
          selectFeature(featureIndex - 1);
        }

      // Plain Tab: move forward through a series
      } else {
        // if no feature selected, or if the last feature is selected, select the first feature
        if (!feature || featureIndex == features.length - 1) {
          selectFeature(0);
        // if a feature is selected, select the next feature
        } else {
          selectFeature(featureIndex + 1);
        }
      }
      e.preventDefault();
    }
    keyboardModeState = {...keyboardModeState, featureIndex}
    if (e.key == "Escape") { // back to menu
      setMode("menu");
      document.getElementById('keyboardModeMenu').focus();
      state.view.popup.close();
      e.preventDefault();
    }
    if (e.key == "Enter") { // go into selected feature
        activateFeatureMode().then(() => document.querySelector("#popup-content>#placeLabel").focus());
        e.preventDefault();
    }
  }

  async function activateFeatureMode() {
    var { feature, featureIndex } = keyboardModeState;
    if (feature) {
        setMode("feature")
      statusAlert(`Feature #${featureIndex + 1} selected.`)
      if (!state.view.popup.visible) {
        state.view.popup.watch('content', (e) => {
          if (document.querySelector("#popup-content>#placeLabel") != null) {
            if (document.querySelector("#popup-content>#placeLabel").innerText != "") {
              document.querySelector("#popup-content>#placeLabel").focus(); // currently nonfunctional, hmm
            }
          }
        })  
        state.view.popup.open();
      }
    } else {
      statusAlert("No feature selected.")
    }
  }

  function featureHandler(e) {
    if (e.key == "Escape") { // back to menu
      setMode("featureSelection");
      document.getElementById('keyboardModeMenu').focus();
      e.preventDefault();
    }
  }

  function helpHandler(e) {
    if (e.key == "Escape") { // back to menu
      document.getElementById('helpDivWrapper').setAttribute
      setMode("menu");
      document.getElementById('keyboardModeMenu').focus();
      e.preventDefault();
    } else {
    }
  }

  window.requests = [];
  var count = 0;

  function popupContent(feature) {
    // Abort any outstanding requests
    if (requests.length > 0) {
      // (At the moment there's no code path to > 1 request, but there was once, and may be later)
      requests.map((r, i) => {
        // Abort requests that are aware of the controller's signal
        r.controller.abort();
      })
      // reset requests stack
      requests = [];
    }
    keyboardModeState.place = null;

    let template = document.getElementById('popup-content-template');
    let div = template.cloneNode(true);
    template.parentElement.appendChild(div);

    if (!div) {
      return console.log('No popup content div')
    }
    div.setAttribute('id', 'popup-content');
    div.setAttribute('style', '');

    var atts = feature.attributes;
    var keys = Object.keys(atts);
    var vals = Object.values(atts);
    let controller = new AbortController();
    let signal = controller.signal;
    count++;
    requests.push({
      controller,
      count
    });

    let url = getLocationRequestURL(feature);
    esriRequest(url, {
      signal,
      responseType: "json"
    }).then(function(response){
      // console.log('queue:', requests.map(r => r.count))
      // The requested data
      var geoJson = response.data;
      // track this in state so the popup knows whether to cancel any outstanding requests
      keyboardModeState.place = geoJson.address.LongLabel;
      document.getElementById('placeLabel').innerHTML = geoJson.address.LongLabel;
    }).catch((err) => {
      if (err.name === 'AbortError') {
        // console.log('Request aborted');
      } else {
        console.error('Error encountered', err);
      }
    });

    div.innerHTML += `${keys.length} feature attributes:`;
    let table = div.querySelector('#popupTable');
    table.setAttribute('tabindex', '0');
    var td;
    for (var x=0; x<keys.length; x++) {
      let row = table.insertRow();
      td = document.createElement('td');
      td.innerText = `${keys[x]}`
      td.setAttribute('tabindex', '0');
      row.appendChild(td);

      td = document.createElement('td');
      td.innerText = `${vals[x]}`
      td.setAttribute('tabindex', '0');
      row.appendChild(td);
    }
    let meta = `Feature #${keyboardModeState.featureIndex + 1} of ${keyboardModeState.features.length}`;
    return {div, meta};
  }

  function getLocationRequestURL(feature) {
    var location = { lon: feature.attributes.locationLongitude, lat: feature.attributes.locationLatitude };
    var url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=pjson&featureTypes=&location=${location.lon}, ${location.lat}`;
    return url;
  }

  async function selectFeature(index) {
    if (typeof index == "undefined") index = keyboardModeState.featureIndex || 0;
    var {view, layer} = state;
    var {feature, features} = keyboardModeState;
    if (!features) {
      await updateFeatures();
      var {features} = keyboardModeState;
    }
    feature = features[index];
    if (!feature) {
      // selected feature may have moved offscreen, so reset selection index to 0
      console.log('oops, no feature at that featureindex');
      index = 0;
      feature = features[index];
      if (!feature) { // still nothing? that's a porblem
        console.error('feature not found')
        return false;
      }
    }
    keyboardModeState = {...keyboardModeState, feature, featureIndex: index};
    view.whenLayerView(layer).then(async layerView => {
      // TODO: figure out why this async function doesn't see the updated state
      // update keyboardModeState again
      keyboardModeState = {...keyboardModeState, feature, featureIndex: index};

      var objectId = feature.attributes.FID;

      if (highlight) {
        highlight.remove();
      }
      highlight = layerView.highlight([objectId]);

      let content = popupContent(feature);
      if (!content) {
        console.log("No popup content")
      }
      view.popup.open({
        title: content.meta,
        content: content.div,
        // Set the location of the popup to the clicked location
        location: { latitude: feature.geometry.latitude, longitude: feature.geometry.longitude},
      });
      statusAlert('Popup: '+content.meta);

      if (document.getElementById('sonarModeCheckbox').checked && !keyboardModeState.sonar) {
        sonarSetup();
      }

      if (keyboardModeState.sonar) {
        let pitch = getPitch(feature);
        part.clear();
        part.add({time: 0, note: pitch, velocity: equalLoudnessContour(pitch) * .8});


        setDecay()
        // restart the playback timeline
        if (Tone.Transport.state == "started") {
          Tone.Transport.stop();
        }
        Tone.Transport.start();
      }
    });
  }

  // TESTS
  loadDataset({env: "prod", datasetId:"8581a7460e144ae09ad25d47f8e82af8_0"});

  // set up global keydown listener - keyboardMode listener is in keyboardModeHandler()
  var keydownListener = window.addEventListener('keydown', async e => {
    let {mode, featureIndex} = keyboardModeState;
    keyStatus(nameKeyCombo(e));

    // keyboardMode active by default
    if (!mode) {
      setKeyboardMode(true);
      setMode("menu")

      if (!state.view) {
        state.view = await drawMap();
      }
    }
    
      // global arrow key navigation – replace default
      let weight = .85; // weighted average – move this percent from the center to the edge

      if (e.key == 'ArrowRight') {
        // debugger
        state.view.goTo(new Point({
          x: (1 - weight) * state.view.center.x + weight * state.view.extent.xmax,
          y: state.view.center.y,
          spatialReference: state.view.spatialReference
        }));

      } else if (e.key == 'ArrowLeft') {

        state.view.goTo(new Point({
          x: (1 - weight) * state.view.center.x + weight * state.view.extent.xmin,
          y: state.view.center.y,
          spatialReference: state.view.spatialReference
        }));

      } else if (e.key == 'ArrowUp') {
        // 85°03'04.0636 = web mercator latitude maximum extent
        if (state.view.center.y < 20037508.34) { // northern extent of web mercator
          let targetY = (1 - weight) * state.view.center.y + weight * state.view.extent.ymax;
          state.view.goTo(new Point({
            x: state.view.center.x,
            y: Math.min(targetY, 20037508.34),
            spatialReference: state.view.spatialReference
          }));
        } else {
          console.log('BZZT north pole')
        }

      } else if (e.key == 'ArrowDown') {
        if (state.view.center.y > -20037508.34) { // southern extent of web mercator
          let targetY = (1 - weight) * state.view.center.y + weight * state.view.extent.ymin;
          state.view.goTo(new Point({
            x: state.view.center.x,
            y: Math.max(targetY, -20037508.34),
            spatialReference: state.view.spatialReference
          }));
        } else {
          console.log('BZZT south pole')
        }

      } else if (e.key == 'c') {
        state.view.goTo({
          target: keyboardModeState.feature,
          zoom: state.view.zoom + 2
        })

      } else if (e.key == 'z') {
        // TODO: error noises when hitting zoom and extent limits
        // if (state.view.zoom < 22) { // effective view.constraints.maxZoom
        // }
        state.view.goTo({
          target: keyboardModeState.mode == 'feature' ? keyboardModeState.feature : null, // defaults to null
          zoom: state.view.zoom + 2
        }).then( async () => {
          if (keyboardModeState.verbose) {
            await state.view.whenLayerView().then(
              statusAlert('z'+state.view.zoom)
            )
          }
        });

      } else if (e.key == 'x') {
        state.view.goTo({
          zoom: state.view.zoom - 2
        }).then( async () => {
          if (keyboardModeState.verbose) {
            await state.view.whenLayerView().then(
              statusAlert('z'+state.view.zoom)
            )
          }
        });

      } else if (e.key == 's') {
        triggerPing();
      } else if (e.key in [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        // do a sonar ping
        if (keyboardModeState.mode) { // if keyboardModeState has been set
          state.view.zoom = e.key;
        }

      } else if (e.key == "Backspace") {
        statusAlert(" ");
        e.preventDefault();
      }


      // keyboardModeHandler(e);
    // deselect feature when it leaves the viewport

    // fix browser reloading when tabbing to the page when map has focus
    if (e.key == "r" && e.metaKey && e.shiftKey) {
      location.reload(true);
    }
  });

  function triggerPing() {
    // do a sonar ping
    if (document.getElementById('sonarModeCheckbox').checked && !keyboardModeState.sonar) {
      sonarSetup();
    }
    ping();
  }
  window.triggerPing = triggerPing;

  var keyupListener = window.addEventListener('keyup', e => {
    let el = document.activeElement;
    focusStatus(el.id ? el.nodeName + ': ' + el.id : el.nodeName);
  });

  // format key names for status display
  function nameKeyCombo(e) {
    let keyName = "";
    switch (e.key) {
      case " ":
        keyName = "space"; break;
      case "Meta":
        keyName = ""; break;
      case "Shift":
        keyName = ""; break;
      default:
        keyName = e.key;
    }
    return (e.metaKey ? "cmd " : "") + (e.shiftKey ? "shift " : "") + keyName;
  }
  function focusStatus(msg) { document.getElementById("focusStatus").innerHTML = msg; }
  function keyStatus(msg) { document.getElementById("keyStatus").innerHTML = msg; }
  function modeStatus(msg) {
    document.getElementById("modeStatus").innerHTML = msg;
    statusAlert(msg + " mode.")
  }
  function statusAlert(msg) { document.getElementById("alertDiv").innerText = `"${msg}"`; }


  // TONE.JS SETUP
  //
  //

  // make a pentatonic scale - root is 1, other notes are ratios relative to 1
  let pentatonic = [1, 1.125, 1.265625, 1.5, 1.6875];
  // chromatic scale, unused because it sounds like hammering a piano
  let chromatic = [1, 1.059463, 1.122462, 1.189207, 1.259921, 1.334839, 1.414213, 1.498307, 1.587401, 1.681792, 1.781797, 1.887748];

  // return a pentatonic scale of n values
  function getPentatonic(n) {
    let octaves = Math.floor(n/5);
    let remainder = n % 5;
    var scale = [];
    // whole octaves
    for (var x = 0; x < octaves; x++) {
      scale.push(...pentatonic.map(a => a * (2**x)));
    }
    // partial octaves
    for (var x = 0; x < remainder; x++) {
      scale.push(pentatonic[x] * (2**octaves));
    }
    return scale;
  }

  // EFFECTS

  // const panner = new Tone.Panner(1).toDestination();
  // panner.pan.rampTo(-1, 0.5);
  var reverb = new Tone.Reverb(2.4).toDestination();

  // COMPONENTS

  const synth = new Tone.PolySynth({maxPolyphony: 128}).chain(reverb).toDestination(); // wet
  // const synth = new Tone.PolySynth({maxPolyphony: 128}).toDestination(); // dry

  // set synth parameters
  synth.set({
    envelope: {
      attack: 0.00001,
      decay: 0.00001,
      // sustain: .5,
      release: 0.001, // fastest release without clicking
    }
  });

  // create a new sequence, which is automatically connected to Tone.Transport
  globals.part = new Tone.Part((time, value) => {
    synth.triggerAttackRelease(value.note, "16n", time, value.velocity);
  });
  globals.part.start(0); // set the starting time of the part

  // SCORE

  // populate part with notes
  async function getNotes() {
    // clear any existing notes
    globals.part.clear();
    // get score
    var notes = arrangeFeatures();
    // add notes to part
    for (let x = 0; x < notes.length; x++) {
      globals.part.add(notes[x]);
    }
    globals.notes = notes;
  }

  function sonarSetup() {
    // set state
    keyboardModeState.sonar = true;
    // activate Tone.js
    Tone.start();
  }

  function setDecay() {
    // set decay with a sigmoid function based on zoom level
    let z = state.view.zoom;
    let maxDecay = 3; // seconds
    let a = .8; // slowness of dropoff
    let decay = (2 * maxDecay * (a ** z)/(a ** z + 1));
    reverb.set({decay: ""+decay}); // needs to be a string, for reasons
  }

  // play a whole-screen sonar ping
  function ping() {
    // console.trace('ping');
    // get notes
    getNotes();
    setDecay();
    if (globals.singleNote) globals.singleNote.mute = true;
    globals.part.mute = false;
    // restart the playback timeline
    if (Tone.Transport.state == "started") {
      Tone.Transport.stop();
    }
    Tone.Transport.start();
  }

  function arrangeFeatures() {
    console.log('\n\n---\n\n')

    if (!keyboardModeState.features) {
      console.error('no features')
      return false;
    }

    let { view } = state;
    let { features } = keyboardModeState;

    //
    // GET PITCHES
    //

    // extract location from all features
    var positions = features.map(a => [a.geometry.x, a.geometry.y]);

    let extent = view.extent;
    // find the view extent
    var xMin = extent.xmin;
    var yMin = extent.ymin;
    var xMax = extent.xmax;
    var yMax = extent.ymax;

    let EARTH_CIRC = 40007862.91725089 // found with esri's GeometryService.distance() function

    // is the extent width > EARTH_CIRC?
    // then the map is zoomed out so far it's showing the left and right sides of the z0 tile,
    // use the edge of the tile instead of the extent.x

    let center = [view.center.x, view.center.y]
    if (extent.xmin < view.center.x - EARTH_CIRC / 2 || extent.xmax > view.center.x + EARTH_CIRC / 2) {
      // account for wraparound – add or subtract the distance around the earth if necessary
      // to ensure the minimum is always less than the maximum, and the center is between them
      let wrapFactor = (view.center.x / EARTH_CIRC);
      wrapFactor = Math.ceil(Math.round(wrapFactor));
      // console.log('wrapFactor:', wrapFactor);

      // TODO: do I need to wraparound all the feature positions? If I do, should I use geo or webmercator?
      // positions = positions.map(a => [a[0] + (EARTH_CIRC * wrapFactor), a[1] + (EARTH_CIRC * wrapFactor)]);
      // positions = positions.map(a => [a[0] + (360 * wrapFactor), a[1] + (360 * wrapFactor)]);
      center[0] = center[0] + (EARTH_CIRC * wrapFactor)

      xMin = center[0] - (EARTH_CIRC / 2);
      xMax = center[0] + (EARTH_CIRC / 2);
    }

    // console.log('xMin:', xMin);
    // console.log('xMax:', xMax);

    // don't use this: keep the pitches relative to the viewport, not the visible map

    // let WEB_MERCATOR_HALF_HEIGHT = 20037508.626927227; // meters from equator to the maximum latitude of the web mercator projection
    // are the top/bottom edges of the map showing?
    // is the extent ymax > 20037508.626927227?
    // is the extent ymax > 20037508.626927227?
    // yMax = Math.max(WEB_MERCATOR_HALF_HEIGHT, extent.ymax);
    // yMin = Math.min(-WEB_MERCATOR_HALF_HEIGHT, extent.ymin);

    // xRange: the range in mercator meters
    var xRange = xMax - xMin;
    var yRange = yMax - yMin;
    
    let notes = globals.numNotes; // maximum number of notes, also number of time divisions

    // set the lowest note in the scale
    // let root = 130.813 // 130hz = c3
    let root = 98 // g2
    // let root = 65.4 // c2
    // let root = 32.70 // c1

    let pitches = globals.numPitches; // maximum number of pitches

    let scale = getPentatonic(pitches);
    var score = [];

    // console.log('notes:', notes, 'dx:', xRange / notes)
    // console.log('pitches:', pitches, 'dy:', yRange / pitches)

    // set up rectbin
    var rectbin = d3.rectbin()
    .dx(xRange / notes)
    .dy(yRange / pitches);

    // the result of the rectbin layout
    let xExtent = [xMin, xMax];
    let yExtent = [yMin, yMax];
    console.log('extents:', xExtent, yExtent)

    // bin the positions
    try {
      var bins = rectbin(positions, xExtent, yExtent);
    }catch(e){
      debugger
    }




    // ASCII GRID CONSOLE OUTPUT

    displayBins(bins); // toggle this comment to enable
    function displayBins(bins) {
      let binContents = [];
      bins.forEach(x => binContents.push(x.length))
      // console.log(binContents);
      let binOutput = [];
      let outputString = '\n';
      try {
        // for some reason rectbin sometimes adds extra columns of bins, so count them –
        // the .i and .j properties of each bin are its coordinate within the binning grid,
        // centered at 0,0, so i will be a range like -4..5, which would be 10 columns, aka 10 notes
        notes = bins[bins.length -1].i - bins[0].i + 1;
        // for (var x = 0; x < bins.length/notes - 1; x++) { // this is flipped horizontally
        // TODO: the bin columns are sorted right-to-left?? what am I missing here
        // TODO: examine pervasive western left-to-right bias in computing
        for (var x = bins.length/notes - 1; x > -1; x--) { // start at the 'end' of each row
          binOutput = [];
          for (var y = 0; y < notes; y++) {
            let value = binContents[x*notes+y];
            binOutput.push(binContents[x*notes+y])
          }
          // padStart for ascii grid console output
          binOutput.forEach(x => {
            outputString += (x == 0 ? '·'.padStart(2) : x.toString(16).padStart(2)); // convert to hex for more compact output
          });
          outputString += '\n';
        }
        console.log(outputString);
      } catch(e) {
        console.log(e);
      }
    }


    // CONVERT BINS TO NOTE.JS SCORE
    // convert bins to times and pitches, with bin count mapped to velocity (aka loudness)

    let duration = 1; // number of seconds per sonar ping
    // get the length of the longest bin: bin with the most points – should map roughly to the largest cluster
    let maxVelocity = bins.reduce((a, b )=> Math.max(a, b.length), 0);
    // console.log('bins:', bins.length, 'maxvelocity:', maxVelocity)
    let volume = 2; // this one goes to Infinity
    // console.log('duration/notes:', duration, notes, duration/notes);

    var output = []; // debugging

    // get bins range, to scale time and notes
    let binsIMin = bins[0].i;
    let binsJMin = bins[0].j;
    let binsIMax = bins[bins.length-1].i;
    let binsJMax = bins[bins.length-1].j;
    let binsIRange = binsIMax - binsIMin;
    let binsJRange = binsJMax - binsJMin;
    // console.log('binsJMin:', binsJMin);
    // console.log('binsJRange:', binsJRange);

    for (var x = 0; x < bins.length; x++) {
      var note = 0;
      var time = 0;
      if (bins[x].length) { // if it has any entries
        // rescale bin range
        let IValue = notes * (bins[x].i - binsIMin)/binsIRange;
        time = IValue * duration/notes;
        // rescale J value to fit into scale range
        let JValue = bins[x].j - binsJMin;
        // if (JValue < 1) debugger
        // pick index into the scale array
        note = root * scale[ Math.max(0, // minimum index value is 0
                             Math.min(scale.length-1, Math.floor(JValue)) // maximum value is the top of the scale
                             ) ];
        // if (isNaN(note)) debugger
        // scale loudness to size of bin, on a curve
        let velocity = Math.max(.1, (bins[x].length / maxVelocity)) * volume;
        // apply equal loudness factor
        velocity = equalLoudnessContour(note) * velocity;
        score.push({ time, note, velocity });
        // console.log(x, time, note)
      }
      // for debugging
      output.push({bin: x, length: bins[x].length, i: bins[x].i, j: bins[x].j, x: bins[x].x, y: bins[x].y, note: note, time: time})
    }

    // console.table(output)
    // console.log(score);

    return score;
  }

  // verrry quick+dirty transfer function to equalize apparent pitch loudness
  // https://en.wikipedia.org/wiki/Equal-loudness_contour
  // input is hz, output is velocity factor
  // 100 => 1
  // 500 => .651
  // 2000 => .349
  function equalLoudnessContour(n) {
    let out = -Math.log10(Math.pow(n, .5)) + 2;
    // console.log('n:', n, 'out:', out);
    return out;
  }

  // get the pitch of a single feature
  // TODO: DRY this out w/arrangeFeatures()
  function getPitch(feature) {
    let position = webMercatorUtils.geographicToWebMercator(new Point([feature.geometry.longitude, feature.geometry.latitude]));

    let extent = state.view.extent;
    var oldLatMin = extent.ymin;
    var oldLatMax = extent.ymax;

    var newLatMin = 0;
    let pitches = 26;
    var newLatMax = pitches - 1; // if using a scale

    let newLatVal = rescale(position.y, oldLatMin, oldLatMax, newLatMin, newLatMax);
    let root = 65.4 // the lowest note in the scale in hz, 65.4 = c2
    let scale = getPentatonic(pitches);
    let val = root * scale[Math.floor(newLatVal)] // use a scale
    return val;
  }

  // scale a value from the range oldMin-oldMax to the range newMin-newMax
  function rescale(val, oldMin, oldMax, newMin, newMax) {
    return (((val - oldMin) * (newMax - newMin)) / (oldMax - oldMin)) + newMin;
  }

  function announceRegion() {
    let controller = new AbortController();
    let signal = controller.signal;

    let location = { lon: state.view.center.longitude, lat: state.view.center.latitude };
    let url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=pjson&featureTypes=&langCode=en&location=${location.lon},${location.lat}`;
    console.log(url)
    esriRequest(url, {
      signal,
      responseType: "json",
    }).then(function(response){
      var geoJson = response.data;
      console.log(geoJson.address)
      // track this in state so the popup knows whether to cancel any outstanding requests
      let z = state.view.zoom;
      let placeName = '';
      if (z < 6) placeName = geoJson.address.Region;
      else if (z < 14) placeName = geoJson.address.Subregion;
      else if (z < 20) placeName = geoJson.address.LongLabel;
      if (placeName == '') placeName = geoJson.address.ShortLabel;
      if (placeName != keyboardModeState.lastPlace) {
        statusAlert(placeName);
        keyboardModeState.lastPlace = placeName;
      }

    }).catch((err) => {
      if (err.name === 'AbortError') {
        console.log('Request aborted');
      } else {
        console.log('Unknown error:', err)
      }
    });
  }

  initKeyboardMode();

})();


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
  generateHistogram,
  HistogramRangeSlider,
  Histogram,
  uniqueValues,
  Legend,
  colorRamps,
  Color,
  viewColorUtils,
  LabelClass,
  CIMSymbol,
  cimSymbolUtils,
  Popup,
  PopupTemplate,
  esriRequest,
] = await loadModules([
  "esri/Map",
  "esri/views/MapView",
  "esri/layers/FeatureLayer",
  "esri/smartMapping/statistics/histogram",
  "esri/widgets/HistogramRangeSlider",
  "esri/widgets/Histogram",
  "esri/smartMapping/statistics/uniqueValues",
  "esri/widgets/Legend",
  "esri/smartMapping/symbology/support/colorRamps",
  "esri/smartMapping/symbology/color",
  "esri/views/support/colorUtils",
  "esri/layers/support/LabelClass",
  "esri/symbols/CIMSymbol",
  "esri/symbols/support/cimSymbolUtils",
  "esri/widgets/Popup",
  "esri/PopupTemplate",
  "esri/request",
]);

  // data urls
  var datasets = {
    'Citclops Water': "8581a7460e144ae09ad25d47f8e82af8_0",
  }

  // track state
  var state = {};
  function initState() {
    state = {
      dataset: null,
      layer: null,
      view: null,
      widgets: [],
      bgColor: null,
      legend: null,
      categoricalMax: 7,
      fieldName: null,
    }
  }

  const DATASET_FIELD_UNIQUE_VALUES = {}; // cache by field name
  var highlight = null;

  //
  // UTILITY FUNCTIONS
  //

  // list all known widget DOM elements
  function listWidgetElements() {
    return [...document.getElementById('filtersList').querySelectorAll('[whereClause]')];
  }

  // concatenate all the where clauses from all the widgets
  function concatWheres( { server = false } = {}) {
    let whereClause = '';
    let widgets = listWidgetElements();
    // generate master here clause with simple string concatenation
    for (const [x, widget] of widgets.entries()) {
      if (x > 0) whereClause += ' AND ';
      let widgetWhere = widget.getAttribute('whereClause');

      // explicit cast for number-likes, for feature layer (server-side) queries ONLY
      // skip for feature layer view (client-side) queries, which work *without* the cast (but fail with it)
      const numberLike = widget.getAttribute('numberLike') === "true";
      if (server && numberLike) {
        const fieldName = widget.getAttribute('fieldName');
        widgetWhere = widgetWhere.replace(fieldName, `CAST(${fieldName} AS FLOAT)`); // for number-like fields
      }

      whereClause += '(' + widgetWhere + ')';
      // whereClause += '(' + widget.getAttribute('whereClause') + ')';
    }
    return whereClause;
  }

  // draw whole map from scratch
  async function drawMap() {
    var {dataset, layer, view} = state;
    const darkModeCheckbox = document.querySelector('#darkMode calcite-checkbox');
    const map = new Map({
      // choose a light or dark background theme as default
      basemap: darkModeCheckbox?.checked ? "dark-gray-vector" : "gray-vector",
      layers: layer,
    });
    if (view) {
      // update existing view, then exit
      view.map = map;
      state = {...state, view}
      // explicitly wait for bgColor to be updated, then update the layerView
      await getBgColor().then(color => {
        state.bgColor = color;
        updateLayerViewEffect();
      });
      return view;
    }
    var view = new MapView({
      container: "viewDiv",
      map: map,
      extent: getDatasetExtent(dataset),
      ui: { components: [] },
      highlightOptions: {
        color: [0, 255, 255],
        fillOpacity: 0.6
      }
    });

    // add toggle checkboxes

    view.ui.add('zoomToData', 'top-right');
    const zoomToDataCheckbox = document.querySelector('#zoomToData calcite-checkbox');
    zoomToDataCheckbox.addEventListener('calciteCheckboxChange', () => {
      updateLayerViewEffect();
    });

    // view.ui.add('darkMode', 'top-right');
    // darkModeCheckbox.addEventListener('calciteCheckboxChange', async () => {
    //   state.view = await drawMap();
    //   autoStyle({fieldName: state.fieldName})
    // });

    // view.ui.add('labels', 'top-right');
    // const labelsCheckbox = document.querySelector('#labels calcite-checkbox');
    // labelsCheckbox.addEventListener('calciteCheckboxChange', () => {
    //   autoStyle({fieldName: state.fieldName})
    // });


    // put vars on window for debugging
    Object.assign(window, { state, map, getDatasetField, getDatasetFieldUniqueValues, /*histogram, histogramValues,*/ generateHistogram, HistogramRangeSlider, uniqueValues });

    // Dataset info
    // document.querySelector('#datasetName').innerHTML = dataset.attributes.name;
    // document.querySelector('#orgName').innerHTML = dataset.attributes.orgName || '';
    // document.querySelector('#recordCount').innerHTML = `${dataset.attributes.recordCount} records`;

    // update state
    state.view = view;
    // bgColor needs state.view to be set first
    state.bgColor = await getBgColor();
    return view;
  }


  async function loadDataset (args) {
    // reset state
    initState();
    var dataset, layer;
    if (args.url) { // dataset url provided directly
      const datasetURL = args.url;
      try {
        // dataset = (await fetch(datasetURL).then(r => r.json()));
        dataset = {attributes: {url: args.url}}
      } catch(e) { console.log('failed to load dataset from url:', args.url, e); }
    } else if (args.datasetId) { // dataset id provided directly
      // https://opendataqa.arcgis.com/api/v3/datasets/97a641ac39904f349fb5fc25b94207f6
      const datasetURL = `https://opendata${args.env === 'qa' ? 'qa' : ''}.arcgis.com/api/v3/datasets/${args.datasetId}`;
      try {
        dataset = (await fetch(datasetURL).then(r => r.json())).data;
      } catch(e) { console.log('failed to load dataset from id', args.datasetId, e); }
    } else if (args.datasetSlug) { // dataset slug provided as alternate
      // https://opendata.arcgis.com/api/v3/datasets?filter%5Bslug%5D=kingcounty%3A%3Aphoto-centers-for-2010-king-county-orthoimagery-project-ortho-image10-point
      const filter = `${encodeURIComponent('filter[slug]')}=${encodeURIComponent(args.datasetSlug)}`
      const datasetURL = `https://opendata${args.env === 'qa' ? 'qa' : ''}.arcgis.com/api/v3/datasets?${filter}`;
      try {
        dataset = (await fetch(datasetURL).then(r => r.json())).data[0];
      } catch(e) { console.log('failed to load dataset from slug', args.datasetSlug, e); }
    }
    // initialize a new layer
    const url = dataset.attributes.url;
    layer = new FeatureLayer({
      renderer: {type: 'simple'},
      url,
      minScale: 0,
      maxScale: 0,
    });
    layer.popupTemplate = {
      title: "Popup Template Title",
      content: "Popup Template Content? {sensorName}"
    }
    // update state
    state = {...state, layer, dataset};


    state.usePredefinedStyle = false; // disable for now
    // draw map once before autoStyling because getBgColor() requires an initialized layerView object
    state.view = await drawMap();
    autoStyle({});  // guess at a style for this field
  }

  // https://stackoverflow.com/questions/6122571/simple-non-secure-hash-function-for-javascript
  function getHash(s) {
    var hash = 0;
    if (s.length == 0) {
        return hash;
    }
    for (var i = 0; i < s.length; i++) {
        var char = s.charCodeAt(i);
        hash = ((hash<<5)-hash)+char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  //
  // STYLING
  //

  // determine whether the map background is dark or light
  async function getBgColor() {
    const {view, layer} = state;
    try {
      // make sure there's a layerView, then
      var bgColor = view.whenLayerView(layer).then(
        // get and return the theme
        async () => await viewColorUtils.getBackgroundColorTheme(view).then(theme => theme));
    } catch(e) {
      console.warn(`Couldn't detect basemap color theme - tab must be in foreground. Choosing "light."\n`, e)
      bgColor = "light"; // set default bgColor
    }
    return bgColor;
  }

  // Choose symbology based on various dataset and theme attributes
  async function autoStyle ({event = null, fieldName = null}) {
    var {dataset, layer, view, usePredefinedStyle} = state;

    // SET COLORS

    // get basemap color theme: "light" or "dark"
    var bgColor = await getBgColor();
    state.bgColor = bgColor;

    // choose default colors based on background theme – dark on light, light on dark
    // use rgb values because CIMSymbols don't understand web color names
    var fillColor = bgColor == "dark" ? [0,196,210,255] : [173,216,230,255]; // lightblue and steelblue
    var strokeColor = bgColor == "dark" ? [70,130,180,255] : [70,130,180,255]; // steelblue and white
    // set bad-value colors
    const badStrokeColor = geotype == "line" ? bgColor == "dark" ? [128,128,128,255] : [64,64,64,255] : [128,128,128,255]; // grey outlines
    const badFillColor = [255,255,255,255]; // white fills
    // set "other" colors for unique-value renderers
    const otherStrokeColor = [128,128,128,255]; // grey
    const otherFillColor = [192,192,192,255]; // light grey

    var symbol;
    var renderer = {
      type: "simple", // autocasts as new SimpleRenderer()
      visualVariables: [],
    };

    // declare shorthand geometry types
    const geometryType = dataset.attributes.geometryType;
    var geotype = (geometryType == 'esriGeometryPoint') ? 'point'
                : (geometryType == 'esriGeometryMultiPoint') ? 'point'
                : (geometryType == 'esriGeometryPolygon') ? 'polygon'
                : (geometryType == 'esriGeometryLine') ? 'line'
                : (geometryType == 'esriGeometryPolyline') ? 'line'
                : geometryType;

    // SET GEOMETRY

    if (geotype === 'point') {
      // use CIMSymbol so we can have sub-pixel outline widths
      var cimsymbol = new CIMSymbol({
        data:  {
          type: "CIMSymbolReference",
          symbol: {
            type: "CIMPointSymbol",
            symbolLayers: [{
                type: "CIMVectorMarker",
                enable: true,
                size: 16,
                frame: {
                  xmin: 0,
                  ymin: 0,
                  xmax: 14,
                  ymax: 14
                },
                markerGraphics: [{
                  type: "CIMMarkerGraphic",
                  geometry: {
                    // circle geo taken from https://developers.arcgis.com/javascript/latest/sample-code/sandbox/index.html?sample=cim-primitive-overrides
                    rings: [
                      [
                        [8.5, 0.2],[7.06, 0.33],[5.66, 0.7],[4.35, 1.31],[3.16, 2.14],[2.14, 3.16],[1.31, 4.35],[0.7, 5.66],[0.33, 7.06],[0.2, 8.5],[0.33, 9.94],[0.7, 11.34],[1.31, 12.65],[2.14, 13.84],[3.16, 14.86],[4.35, 15.69],[5.66, 16.3],[7.06, 16.67],[8.5, 16.8],[9.94, 16.67],[11.34, 16.3],[12.65, 15.69],[13.84, 14.86],[14.86, 13.84],[15.69, 12.65],[16.3, 11.34],[16.67, 9.94],[16.8, 8.5],[16.67, 7.06],[16.3, 5.66],[15.69, 4.35],[14.86, 3.16],[13.84, 2.14],[12.65, 1.31],[11.34, 0.7],[9.94, 0.33],[8.5, 0.2]
                      ]
                    ]},
                  symbol: {
                    type: "CIMPolygonSymbol",
                    symbolLayers: [
                      {
                        type: "CIMSolidStroke",
                        width: .45,
                        color: strokeColor,
                      },
                      {
                        type: "CIMSolidFill",
                        color: fillColor,
                      },
                    ]
                  }
                }]
            }]
          }
        }
      });
      symbol = cimsymbol;

    } else if (geotype === 'line') {
      symbol = {
        type: 'simple-line',
        width: '2px',
        color: strokeColor,
      };

    } else if (geotype === 'polygon') {
      symbol = {
        type: 'simple-fill',
        color: fillColor,
        outline: {
          color: strokeColor,
          width: 0.5,
        },
      };
    }

    // GET FIELD

    // check for fieldName in args, the event object,
    if (!fieldName) { fieldName = event?.currentTarget?.getAttribute('data-field'); }
    // a displayField specified in the dataset,
    if (!fieldName) { fieldName = dataset?.attributes?.displayField; }
    // or just set default fieldName to "NAME"
    if (!fieldName && dataset.attributes.fieldNames.includes("NAME")) { fieldName = "NAME"; }

    // if there's a fieldName then style it by field
    fieldStyle: // label this block so we can break out of it when necessary
    if (fieldName) {
      state.fieldName = fieldName; // used by toggle checkboxes
      var field = getDatasetField(fieldName);
      // TODO: don't use cached statistics, as they're frequently out-of-date and incomplete
      var fieldStats = field.statistics;
      if (fieldStats.values.length == 0) { // it happens
        console.warn("Couldn't get statistics values for field '"+fieldName+"'.");
        break fieldStyle;
      }
      try {
        // sometimes stats have .min and .max, sometimes they have .value and .count
        var { categorical, pseudoCategorical } = await datasetFieldCategorical(fieldName);
        var numberLike = await datasetFieldIsNumberLike(fieldName);
        if (field.simpleType == "string" && numberLike) {
          // recast values as numbers and resort
          fieldStats.values = fieldStats.values.map(e => Object.assign({...e, value: parseFloat(e.value)}))
            .sort((a, b) => a.value !== b.value ? a.value < b.value ? -1 : 1 : 0);
        }
        var minValue =
          typeof fieldStats.values.min !== "undefined" ? fieldStats.values.min :
          typeof fieldStats.values.length !== "undefined" ? fieldStats.values[0].value :
          null;
        var minLabel = minValue;
        var maxValue =
          typeof fieldStats.values.max !== "undefined" ? fieldStats.values.max :
          typeof fieldStats.values.length !== "undefined" ? fieldStats.values[fieldStats.values.length -1].value :
          null;
        var maxLabel = maxValue;
      } catch(e) {
        console.warn("Couldn't get statistics for styling field '"+fieldName+"':", e);
        break fieldStyle;
      }

      // don't use predefined styles for now
      // } else if (usePredefinedStyle) {
      //   // check for built-in style passed in with the dataset
      //   let predefinedStyle = dataset.attributes?.layer?.drawingInfo;
      //   if (predefinedStyle && usePredefinedStyle) {
      //     layer = await new FeatureLayer({
      //       // renderer: jsonUtils.fromJSON(predefinedStyle.renderer),
      //       // url
      //     });
      //   }
      // }

      // don't use predefined labelingInfo for now
      // if (layer.labelingInfo && !usePredefinedStyle) {}

      // clear any existing labelingInfo sent from the server
      layer.labelingInfo = [ ];
      var uniqueValues = (await getDatasetFieldUniqueValues(fieldName)).values;
      var numGoodValues = uniqueValues.filter(i => !isBadValue(i.value)).length;

      // STYLING

      // reset colors – these will be used as "No value" symbols
      symbol = copyAndColor(symbol, strokeColor, fillColor);

      let {categoricalMax} = state;
      if (categorical || (pseudoCategorical && !numberLike)) {
        // your basic categorical field
        // GET RAMP
        let ramp = colorRamps.byName("Mushroom Soup");
        let rampColors = ramp.colors;
        var numColors = rampColors.length;

        // if the field has only a single unique non-bad value, pick a single color, hashing by fieldName –
        // this will be more likely to show a visual change when switching between two fields which both have a single value
        if ( (numGoodValues == 1) ||
            ((fieldStats.values.min && fieldStats.values.max) &&
                (fieldStats.values.min === fieldStats.values.max))
            ) {
          var indexOffset = getHash(fieldName) % numColors; // pick an offset
          // replace the entire ramp with a single color
          rampColors = [rampColors[indexOffset]];
          numColors = 1;
        }

        // sort by values - if only pseudocategorical leave it sorted by the default: prevalence
        if (categorical) {
          uniqueValues.sort((a, b) => a.value !== b.value ? a.value < b.value ? -1 : 1 : 0);
        }
        // TODO: sort before assigning color values? currently values are assigned color by frequency

        // generate categorical colors for field
        var uniqueValueInfos = [];
        // pick a limit to the number of legend entries
        const numEntries = categorical ? Math.min(uniqueValues.length, categoricalMax) : // the top categories
                           pseudoCategorical <= categoricalMax ? pseudoCategorical : // the top pseudocategories
                           5; // just show the top 5
        if (numGoodValues == 0 && uniqueValues.length == 1) { // it happens
          var defaultSymbol = copyAndColor(symbol, badStrokeColor, badFillColor);
          var defaultLabel = "No value";
        } else {
          for (let x = 0; x < numEntries; x++) {
            if (isBadValue(uniqueValues[x].value)) {
              // style any bad points as white rings and lines as grey
              var strokeColor = badStrokeColor;
              var fillColor = badFillColor;

            } else {
              // rollover calculation
              // TODO: interpolate over whole range to prevent duplicate colors
              var indexOffset = x % numColors;
              var strokeColor = [
                // TODO: switch to proportional interpolation
                rampColors[indexOffset].r * .5, // same as fillColor but half as bright
                rampColors[indexOffset].g * .5,
                rampColors[indexOffset].b * .5,
                255 //alpha is always opaque
              ];
              // set fillColor
              var fillColor = [
                rampColors[indexOffset].r,
                rampColors[indexOffset].g,
                rampColors[indexOffset].b,
                255 // alpha is always opaque
              ];
            }

            // clone and color symbol
            let uniqueSymbol = copyAndColor(symbol, strokeColor, fillColor);
            // add symbol to the stack
            uniqueValueInfos.push( {
              value: uniqueValues[x].value || "",
              label: field.simpleType == "date" ? formatDate(uniqueValues[x].value) :
                      isBadValue(uniqueValues[x].value) ? "No value" :
                      uniqueValues[x].value,
              symbol: uniqueSymbol,
            });
          }
        }

        let numOthers = uniqueValues.length - numEntries;
        // set defaults
        if (numOthers > 0) {
          // use the "other" default color for the long tail of categories
          var defaultSymbol = copyAndColor(symbol, otherStrokeColor, otherFillColor);
          var defaultLabel = (numOthers + " other") + (numOthers > 1 ? "s" : "");
        }

        // set renderer
        renderer = {...renderer,
          type: "unique-value",
          defaultSymbol,
          defaultLabel,
          uniqueValueInfos,
        };
      } else if (numberLike) { // number-like and non-categorical
        // SET RAMP
        // custom ramp - pink to blue
        var rMin = {r:255, g:200, b:221, a:255};
        var rMax = bgColor == "dark" ? {r:61, g:79, b:168, a:255} : {r:21, g:39, b:128, a:255};

        renderer.visualVariables.push({
          type: "color",
          field: fieldName,
          stops: [{
            value: minValue,
            color: {r: rMin.r, g: rMin.g, b: rMin.b, a: 1},
            label: (field.simpleType == "date") ? formatDate(minValue) : minLabel
          },{
            value: maxValue,
            color: {r: rMax.r, g: rMax.g, b: rMax.b, a: 1},
            label: (field.simpleType == "date") ? formatDate(maxValue) : maxLabel
          }]
        });

        if (field.simpleType !== "date") {
          // add one more midValue
          var midValue = (parseFloat(maxValue)+parseFloat(minValue))/2;
          // if min and max are integers, make mid integer too
          if (numberLike && (Number.isInteger(parseFloat(maxValue)) && Number.isInteger(parseFloat(maxValue)))) {
            midValue = parseInt(midValue+.5);
          }
          if (midValue != minValue && midValue !== maxValue) {
            // ensure accurate placement of midValue along the ramp, in case of integer coersion
            let divisor = (midValue-minValue)/(maxValue - minValue);
            // color
            var rMid = {r: (rMax.r + rMin.r) * divisor, g: (rMax.g + rMin.g) * divisor, b: (rMax.b + rMin.b) * divisor};
            renderer.visualVariables[renderer.visualVariables.length-1].stops.push({
                value: midValue,
                color: {r: rMid.r, g: rMid.g, b: rMid.b, a: 1},
                label: midValue,
            });
          }
        }
        // set default label
        renderer.label = numGoodValues < uniqueValues.length ? "No value" : "Feature";
      // if it's neither categorical nor number-like, use default styling but add labels
      } else {
        layer.labelingInfo = [ addLabels(fieldName) ];
      }
    } // end if (fieldName)

    renderer = {...renderer, symbol, field: fieldName};

    // also add labels if the "Labels on" toggle is checked
    if (document.querySelector('#labels calcite-checkbox')?.checked && fieldName) {
      layer.labelingInfo = [ addLabels(fieldName) ];
    }

    // SET SCALE

    if (geotype == "point") {
      renderer.visualVariables.push({
        type: "size",
        valueExpression: "$view.scale",
        // zoom levels and scale values based on layerView.zoom and layerView.scale
        stops: [
          {
            size: 3.5,
            value: 36978595.474472 // z3
          },
          {
            size: 4.5,
            value: 577790.554289 // z9
          },
          {
            size: 6,
            value: 18055.954822 // z15
          },
        ]
      });
    } else if (geotype == "line") {
      renderer.visualVariables.push({
        type: "size",
        valueExpression: "$view.scale",
        stops: [
          {
            size: .5,
            value: 1155581.108577 // z8
          },
          {
            size: 1,
            value: 577790.554289 // z9
          },
          {
            size: 2,
            value: 144447.638572 // z11
          },
        ]
      });
    }

    // ADD LABELS

    // add labels by default to polygons only for now
    if (geotype == "polygon") {
      if (!bgColor) {
        // bgcolor might not be set if the tab wasn't visible when loaded, give it another chance
        bgColor = await getBgColor();
      }
      if (fieldName) {
        var expression = "$feature."+fieldName;
        // label if field matches a few conditions:
        if (
          // there's more than one value
          uniqueValues.length > 1 &&
          (
            (simpleFieldType == "string" && !numberLike) ||  // it's a non-numberlike string, or
            (field.statistics.values.count == uniqueValues.length) // every value is unique
          )
        ){
          // TODO: don't violate DRY (labels also set above)
          const labels = new LabelClass({
            labelExpressionInfo: expression ? { expression } : null,
            symbol: {
              type: "text",  // autocasts as new TextSymbol()
              color: bgColor == "light" ? "#1e4667" : "black",
              haloSize: 1.5,
              haloColor: bgColor == "light" ? "white" : "black",
              font: {
                size: '14px',
              }
            }
          });
          layer.labelingInfo = [ labels ];
        }
      }
    }

    // ADD LEGEND

    var {legend, view} = state;
    if (fieldName) {
      // remove and replace legend entirely rather than updating, to avoid dojo issues
      view.ui.remove(legend);
      legend = await new Legend({
        view,
      })
      legend.layerInfos = [{
        layer,
      }]
      view.ui.add(legend, "bottom-right");
    } else {
      view.ui.remove(legend);
      legend = null;
    }

    layer.renderer = renderer; // replace the old renderer
    layer.refresh(); // ensure the layer draws

    // update state
    state = {...state, layer, view, renderer, bgColor, legend}
  } // end autoStyle

  //
  // STYLING UTILITY FUNCTIONS
  //

  // check for weirdness
  function isBadValue(value) {
    return (value === null ||          // null
            value === "" ||            // empty string
            (/^\s+$/.test(value)));   // all whitespace
  }

  // copy a symbol and apply colors
  function copyAndColor(symbol, strokeColor, fillColor) {
    if (symbol.type == 'cim') {
      // clone symbol
      var newSymbol = symbol.clone();
      cimSymbolUtils.applyCIMSymbolColor(newSymbol, fillColor);
      newSymbol.data.symbol.symbolLayers[0].markerGraphics[0].symbol.symbolLayers[0].color = strokeColor;
    } else {
      newSymbol = Object.assign({}, symbol);
      newSymbol.color = fillColor;
      if (symbol.type !== "simple-line") {
        newSymbol.outline.color = strokeColor;
      }
    }
    return newSymbol;
  }


  // add labels to a layer
  function addLabels(fieldName) {
    return new LabelClass({
      labelExpressionInfo: { expression: "$feature."+fieldName },
      symbol: {
        type: "text",  // autocasts as new TextSymbol()
        color: state.bgColor == "light" ? "#1e4667" : "white",
        haloSize: 1.5,
        haloColor: state.bgColor == "light" ? "white" : "black",
        font: {
          size: '14px',
        }
      }
      // these ArcGIS label class properties don't exist in the JSAPI ... yet
      // removeDuplicates: "all",
      // removeDuplicatesDistance: 0,
      // repeatLabel: false,
      // repeatLabelDistance: 500,
    });
  }

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

  // get a field object from a field name
  function getDatasetField (fieldName) {
    let lc_fieldName = fieldName.toLowerCase();
    const field = state.dataset.attributes.fields.find(f => f.name.toLowerCase() === lc_fieldName);
    if (!field) {
      throw new Error(`Could not find field "${fieldName}" in dataset.`);
    }
    const stats = [...Object.entries(state.dataset.attributes.statistics).values()].find(([, fields]) => fields[lc_fieldName]);

    // add "simple type" (numeric, date, string) and stats into rest of field definition
    return {
      ...field,
      simpleType: stats && stats[0],
      statistics: stats && stats[1][lc_fieldName].statistics
    }
  }

  // get the unique values of a field
  async function getDatasetFieldUniqueValues (fieldName) {
    var {layer} = state;
    if (!DATASET_FIELD_UNIQUE_VALUES[fieldName]) {
      const field = getDatasetField(fieldName);
      let stats;
    if (layer) {
      const uniqueValueInfos = (await uniqueValues({ layer: state.layer, field: fieldName }))
        .uniqueValueInfos
        .sort((a, b) => a.count > b.count ? -1 : 1);
        const count = uniqueValueInfos.reduce((count, f) => count + f.count, 0);
        stats = {
          count,
          uniqueCount: uniqueValueInfos.length,
          values: uniqueValueInfos
        }
      }
      stats.uniqueCount = stats.values.length;
      // add percent of records
      stats.values = stats.values
      // .filter(v => v.value != null && (typeof v.value !== 'string' || v.value.trim() !== ''))
      .map(v => ({ ...v, pct: v.count / stats.count }));
      // get top values
      const maxTopValCount = 12;
      // stats.topValues = stats.values.slice(0, maxTopValCount);
      stats.topValues = [];
      if (stats.uniqueCount < maxTopValCount) {
        stats.topValues = stats.values;
      } else {
        let coverage = 0;
        for (let i=0, coverage=0; i < stats.values.length; i++) {
          // let stat = { ...stats.values[i], pct: stats.values[i].count / recordCount };
          const stat = stats.values[i];
          // if (coverage >= 0.80 && stat.pct < 0.05 && stats.topValues.length >= maxTopValCount) break;
          if (stat.pct < 0.015 || stats.topValues.length >= maxTopValCount) break;
          stats.topValues.push(stat);
          coverage += stat.pct;
        }
      }
      // cache
      DATASET_FIELD_UNIQUE_VALUES[fieldName] = stats;
    }
    return DATASET_FIELD_UNIQUE_VALUES[fieldName];
  }

  // Determine if field is categorical or pseudo-categorical
  async function datasetFieldCategorical (fieldName) {
    var {categoricalMax} = state;
    const field = await getDatasetField(fieldName);
    const stats = await getDatasetFieldUniqueValues(fieldName);
    const categorical = stats.uniqueCount <= categoricalMax;
    const pseudoCategoricalMin = .8; // the proportion of unique values to total values is < 80%
    // sum the values until you reach at least pseudoCategoricalMin
    const coverage = Object.values(stats.values).reduce(
      // accumulator object - pull .pct from each value
      ({sum, i}, {pct}) =>
        (sum < pseudoCategoricalMin ? // still not there?
        {sum: sum + pct, i: i + 1} : // keep adding
        {sum, i}), // otherwise just keep returning the current value
          // TODO: break once the value is reached
        {sum: 0, i: 0}); // init value
    // return the number of unique values which comprise pseudoCategoricalMin% of the features, or false
    const pseudoCategorical = coverage.sum >= pseudoCategoricalMin ? coverage.i : false;
    return { categorical, pseudoCategorical };
  }

  // Determine if field is number-like, e.g. is a number or all non-null values can be parsed as such
  async function datasetFieldIsNumberLike (fieldName) {
    const field = getDatasetField(fieldName);
    if (field.simpleType === 'numeric') { // explicit number type
      return true;
    } else { // or check the known values to see if they're all integers
      const stats = await getDatasetFieldUniqueValues(field.name);
      return stats.values.every(v => v.value == null || !isNaN(Number(v.value)));
    }
  }

  function simpleFieldType (fieldType) {
    const fieldTypes = {
      esriFieldTypeGlobalID: 'text',
      esriFieldTypeGUID: 'text',
      esriFieldTypeDate: 'date-time',
      esriFieldTypeString: 'string',
      esriFieldTypeSingle: 'number',
      esriFieldTypeFloat: 'number',
      esriFieldTypeDouble: 'number',
      esriFieldTypeInteger: 'number',
      esriFieldTypeSmallInteger: 'number',
      esriFieldTypeOID: 'number',
    };

    return fieldTypes[fieldType] || '';
  }


  //
  // KEYBOARD NAVIGATION MODE
  //
  var keyboardModeActive = false;

  async function showKeyboardModeCheckbox(value) {
    let { view, layer } = state;
    console.log('showKeyboardModeCheckbox', value)
    keyboardModeActive = value;
    if (!keyboardModeActive) {
      document.getElementById("keyboardModeLabel").innerText = "Keyboard mode off."
      console.log('keyboardMode off');
      window.removeEventListener('keydown', keyboardModeHandler);
      return;
    } else {
      console.log('keyboardMode on');
      document.getElementById("keyboardModeLabel").innerText = "Keyboard mode on."
      var keyboardModeKeydownListener = window.addEventListener('keydown', keyboardModeHandler);
      if (!view) {
        view = await drawMap();
      }
      view.whenLayerView(layer).then(async function(layerView) {
        layerView.watch("updating", function(value) {
          if (!value) {
            // wait for the layer view to finish updating

            // get all the features available for drawing.
            layerView
              .queryFeatures({
                geometry: view.extent,
                returnGeometry: true
              })
              .then(function(results) {
                // do something with the resulting graphics
                let graphics = results.features;
                // console.log(graphics)
              });
          }
        });
        var features = (await state.layer.queryFeatures()).features;
        features.sort((a, b) => (a.geometry.longitude > b.geometry.longitude) ? 1 : -1);

        // debugger
        keyboardNavState = {...keyboardNavState,
          features,
          feature: features[0],
          featureIndex: 0
        };
        selectFeature(features[0]);
      });
    }
  }

  var keyboardNavState = {
    features: null,
    feature: null,
    featureIndex: null,
    modeLevel: 0,
    place: null
  };

  // key event trapping and mode management for Keyboard Mode
  function keyboardModeHandler(e) {
    let { features, feature, featureIndex, modeLevel } = keyboardNavState;
    // statusAlert('Floor ' + modeLevel + '.');
    console.log(e.key)

    switch (e.key) {
      case "Enter": {
        // Enter: go in one layer
        handleEnter(modeLevel);
        break;
      }
      case "Escape": {
        handleEscape(modeLevel);
        break;
      }
      case "Tab": {
        handleTab(modeLevel);
        break;
      }
      default: {
        // handleEscape(modeLevel);
        break;
      }
    }

    if (e.key == "Enter") {
    // Escape: go out one layer
    } else if (e.key == "Escape") {

    // Tab: move through a linear series
    } else if (e.key == "Tab") {

    }
    keyboardNavState = {...keyboardNavState, feature, featureIndex, modeLevel};
    // prevent standard event behavior
    if (modeLevel == 0) {
      e.preventDefault();
    }
    modeStatus(modeLevel)

    return false;
  }

  function handleEnter() {
    // if on the map container, move down one modal level to feature selection mode
    if (modeLevel < 1) modeLevel++;
    // if feature is selected, move down one modal level, move focus to popup div
    if (modeLevel == 1) {
      document.activeElement.blur();
      if (!document.getElementById("popup-content")) {
        // make a popup
      }
      document.getElementById("popup-content").focus();
      statusAlert(`Feature #${featureIndex} selected.`)
    }

  }

  function handleEscape() {
    if (!modeLevel && document.getElementsByClassName("esri-popup")[0]) {
      state.view.popup.close();
    }
    if (modeLevel > -3) {
      modeLevel--;
    }

    // if feature is selected, move up one modal level to the map and turn off keyboardMode
    if (modeLevel == -1) {
      document.activeElement.blur();
      document.getElementsByClassName("esri-popup")[0].focus();
      document.querySelector('#keyboardMode');
      document.querySelector('#keyboardMode').getElementsByTagName('calcite-checkbox')[0].checked = false;
      document.getElementById("keyboardModeLabel").innerText = "Keyboard mode off";
      state.view.popup.close();
    }

    // if inside a popup, move up one modal level to feature selection mode
    if (modeLevel == 0) {
      document.activeElement.blur();
      statusAlert("Leaving feature. Feature selection.")
    }

  }

  function handleTab() {
    // if the keyboardMode context div is not selected, there has been mouse interaction -
    // move focus to the context div and select the last selected feature
    if (modeLevel == -1) {
      return;
      // return e.preventDefault();
    }
    if (modeLevel == 1) {
      console.log('tab through popup', document.activeElement)
      return;
      // return e.preventDefault();
    }

    // Shift-Tab: move backward through the series
    if (e.shiftKey) {
      console.log('keyboardModeHandler shift-tab')
      // if no feature selected, select the last feature
      if (featureIndex < 0) {

      }

      if (!feature) {
        featureIndex = 0;
        feature = features[0];
        selectFeature(feature);
      }
      // if the first feature is selected, move focus to the keyboardMode checkbox
      else if (featureIndex == 0) {
      }
      // if a feature is selected, select the previous feature
      else {
        featureIndex--;
        feature = features[featureIndex];
        selectFeature(feature);
      }

    // Tab: move forward through a series
    } else {
      // console.log('keyboardModeHandler normal tab')
      // if no feature selected, select the first feature
      if (!feature) {
        featureIndex = 0;
        feature = features[0];
        selectFeature(feature);
      }
      // if the last feature is selected, leave current feature selected but move focus to the next ui checkbox
      else if (featureIndex == features.length-1) {
      }
      // if a feature is selected, select the next feature
      else {
        featureIndex++;
        feature = features[featureIndex];
        selectFeature(feature);
        // sound.stop();
        // sound.start();
      }
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
    keyboardNavState.place = null;
    console.log('feature?', feature)
    var location = { lon: feature.attributes.locationLongitude, lat: feature.attributes.locationLatitude };
    var url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=pjson&featureTypes=&location=${location.lon}, ${location.lat}`;
    console.log('url:\n', url)


    let template = document.getElementById('popup-content-template');
    console.log('template:', template)
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

    esriRequest(url, {
      signal,
      responseType: "json"
    }).then(function(response){
      // console.log('queue:', requests.map(r => r.count))
      // The requested data
      var geoJson = response.data;
      // track this in state so the popup knows whether to cancel any outstanding requests
      keyboardNavState.place = geoJson.address.LongLabel;
      document.getElementById('placeLabel').innerHTML = geoJson.address.LongLabel;
    }).catch((err) => {
      if (err.name === 'AbortError') {
        console.log('Request aborted');
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
    let meta = `Feature #${keyboardNavState.featureIndex} of ${keyboardNavState.features.length}`;
    return {div, meta};
  }

  async function selectFeature(feature) {
    console.trace('selectFeature')
    if (!feature) {
      return console.log("No feature selected")
    }
  let {view, layer} = state;
    view.whenLayerView(layer).then(async function(layerView) {
      var objectId = feature.attributes.FID;

      if (highlight) {
        highlight.remove();
      }
      highlight = layerView.highlight([objectId]);
      view.popup.watch("visible", (e) => {
        // console.log('popup visible?', e)
        if (document.getElementById("popup-content")) {
          document.activeElement.blur();
          document.getElementById("popup-content").focus();
          console.log('focused:', document.activeElement)
        } else {
          // console.log('no popup', e)
        }
      });
      let content = popupContent(feature);
      if (!content) {
        return console.log("No popup content")
      }
      view.popup.open({
        title: content.meta,
        content: content.div,
        // Set the location of the popup to the clicked location
        location: { latitude: feature.geometry.latitude, longitude: feature.geometry.longitude},
      });
      statusAlert('Popup: '+content.meta);
    });
  }

  // TESTS
  loadDataset({env: "prod", datasetId:"8581a7460e144ae09ad25d47f8e82af8_0"});

  // set up global keydown listener - keybaordMode listener is in keyboardModeHandler()
  var keydownListener = window.addEventListener('keydown', async e => {
    let el = document.activeElement;
    focusStatus(el.id ? el.nodeName + ': ' + el.id : el.nodeName);
    keyStatus(nameKeyCombo(e));

    // activate keyboardMode when tabbing into map
    if (!keyboardModeActive) {
      if (e.key == "Tab") {
        if (document.activeElement == document.getElementById('viewDiv')) {
          console.log('activate')
          focusStatus('activate');
          // show keyboard mode checkbox
          const keyboardCheckbox = document.querySelector('#keyboardMode');
          // debugger
          keyboardCheckbox.classList.remove("hidden");
          keyboardCheckbox.addEventListener('calciteCheckboxChange', (e) => {
            if (e.target.checked) {
              showKeyboardModeCheckbox(true);
            } else {
              showKeyboardModeCheckbox(false);
            }
          });
          if (!state.view) {
            state.view = await drawMap();
          }
          state.view.ui.add('keyboardMode', 'top-left');
        } else {
          // e.preventDefault();
        }
      }
    }
    // fix browser reloading when tabbing to the page when map has focus
    if (e.key == "r" && e.metaKey && e.shiftKey) {
      location.reload(true);
    }
  });

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
    // statusAlert('Floor ' + keyboardNavState.modeLevel + '.');
  }
  function statusAlert(msg) { document.getElementById("keyboardModeAlert").innerHTML = msg; }



})();

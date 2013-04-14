L.CouchMap = function (options) {
  var options = L.extend({
      'nodesUrl': '_view/nodes',
      'nodesUrlSpatial': '_spatial/nodes',
      'nodesUrlCoarse': '_view/nodes_coarse',
      'coarseThreshold': 0,   // switch to coarse if this number of nodes
                              // is exceeded
      'coarseGranularity': 2, // 0: very coarse, 1 medium, 2 fine
    }, options);

  var map = null;
  var active = false;
  var requests = []; // all currently running ajax requests

  function requestFail(jqXHR) {
    var i = requests.indexOf(jqXHR);
    console.log('request '+i+' failed, removing from queue');
    requests.splice(i, 1);
  }

  var layers_enabled = {
    'nodes': false,
    'links': false
  };

  var layers = {
    'nodes': new L.CMLayerGroup( setLayer('nodes', true), setLayer('nodes', false) ),
    'links': new L.CMLayerGroup( setLayer('links', true), setLayer('links', false) )
  };

  var layer_nodes_coarse = new L.LayerGroup();
  var layer_nodes_fine = new L.MarkerClusterGroup();

  // receives the count in the current bounding box and decides
  // whehter all data should be fetched or only a few more counts
  function processBboxCount(data) {
    if (data.count < options['coarseThreshold']) {
      // fetch all data
    } else {
      // partition bbox and request counts for each partition
      tiles = getTilesInBbox(map.getBounds(), Math.min(map.getZoom()+options['coarseGranularity'], map.getMaxZoom()));

      // $.post doesn't work (contentType cannot be passed)
      requests.push( $.ajax({
        type: 'POST',
        dataType: 'json',
        contentType: 'application/json',
        data: JSON.stringify({'keys': tiles}),
        url: options['nodesUrlCoarse']+'?group=true',
        success: processCoarseCount
      }).fail(requestFail) );
    }
  }

  // shows coarse counts
  function processCoarseCount(data) {
    layers['nodes'].clearLayers().addLayer( layer_nodes_coarse.clearLayers() );

    for (var i=0, item; item=data.rows[i++]; ) {
      var zoom = item.key[0],
          x = item.key[1],
          y = item.key[2],
          a = tile2LatLng(x, y, zoom),
          b = tile2LatLng(x+1, y+1, zoom);
      // place marker in the middle of the tile
      var icon = new L.DivIcon({ html: '<div><span>' + item.value + '</span></div>', className: 'marker-cluster marker-cluster-large', iconSize: new L.Point(40, 40) });

      L.marker( [ (a.lat+b.lat)/2, (a.lng+b.lng)/2], {icon: icon}).addTo(layer_nodes_coarse);
    }
  }

  function getTilesInBbox(bbox, zoom) {
    var center = bbox.getCenter(),
        x = long2tile(center.lng, zoom),
        y = lat2tile(center.lat, zoom);
    for (var xmin=x;   bbox.contains( [ center.lat, tile2long(xmin, zoom)] ); xmin--){};
    for (var xmax=x+1; bbox.contains( [ center.lat, tile2long(xmax, zoom)] ); xmax++){};
    for (var ymin=y;   bbox.contains( [ tile2lat(ymin, zoom), center.lng ] ); ymin--){};
    for (var ymax=y+1; bbox.contains( [ tile2lat(ymax, zoom), center.lng ] ); ymax++){};

    tiles = [];
    for (var y=ymin; y<ymax; y++) {
      for (var x=xmin; x<xmax; x++) {
        tiles.push([zoom,x,y]);
      }
    }
    return tiles;
  }

  // called whenever the bounding box of the map changed
  function onBboxChange(e) {
    var bboxstr = map.getBounds().toBBoxString();

    // abort any running ajax requests
    for (var i=0, request; request=requests[i++];) {
      request.abort();
    }
    requests = [];

    // probe number of nodes in new bbox, then decide what to do
    requests.push(
      $.getJSON(options['nodesUrlSpatial'], { "bbox": bboxstr, count: true },
        processBboxCount
      ).fail(requestFail)
    );
  }

  function activate() {
    active = true;
    map.on('moveend', onBboxChange);
    // simulate bounding box change when activated
    onBboxChange();
  }

  function deactivate() {
    active = false;
    map.off('moveend', onBboxChange);
  }

  function updateLayer() {
    var active_new = false;
    for (layername in layers_enabled) {
      if (layers_enabled[layername]) {
        active_new = true;
      }
    }
    if (active && !active_new) {
      deactivate();
    } else if (!active && active_new) {
      activate();
    }
  }

  function setLayer(layername, enable) {
    return function (layermap) {
      layers_enabled[layername] = enable;
      map = layermap;
      updateLayer();
    }
  }

  this.getLayers = function() {
    return layers;
  }

  // *************************************************************************
  // Helper functions
  // *************************************************************************

  // cf. http://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
  function long2tile(lon,zoom) {
    return (Math.floor((lon+180)/360*Math.pow(2,zoom)));
  }

  function lat2tile(lat,zoom)  {
    return (Math.floor((1-Math.log(Math.tan(lat*Math.PI/180) + 1/Math.cos(lat*Math.PI/180))/Math.PI)/2 *Math.pow(2,zoom)));
  }

  // returns NW-corner of tile
  function tile2long(x,z) {
    return (x/Math.pow(2,z)*360-180);
  }

  function tile2lat(y,z) {
    var n=Math.PI-2*Math.PI*y/Math.pow(2,z);
    return (180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))));
  }

  function tile2LatLng(x,y,z) {
    return new L.LatLng(tile2lat(y,z), tile2long(x,z));
  }
}

// we enhance the onAdd and onRemove functions s.t. they call the provided
// handler onAdded and onRemoved
L.CMLayerGroup = function (onAdded, onRemoved) {
  this.onAdded = onAdded || (function () {});
  this.onRemoved = onRemoved || function () {};
  var args = Array.prototype.slice.call(arguments);
  L.LayerGroup.apply(this, args.slice(2));
}
L.CMLayerGroup.prototype = new L.LayerGroup();
L.CMLayerGroup.prototype.constructor = new L.CMLayerGroup;

L.CMLayerGroup.prototype.onAdd = function (map) {
  var ret = L.LayerGroup.prototype.onAdd.call(this, map);
  this.onAdded(map);
  return ret;
}

L.CMLayerGroup.prototype.onRemove = function (map) {
  var ret = L.LayerGroup.prototype.onRemove.call(this, map);
  this.onRemoved(map);
  return ret;
}

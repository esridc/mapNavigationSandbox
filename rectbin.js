(function() {

  d3.rectbin = function() {
    var dx = 0.1,
        dy = 0.1,
        x = rectbinX,
        y = rectbinY;

    function rectbin(points, xExtent = null, yExtent = null) {
      var binsById = {};
      // console.log('Extent?', xExtent, yExtent)
      if (!xExtent) xExtent = d3.extent(points, function(d, i){ return x.call(rectbin, d, i) ;});
      if (!yExtent) yExtent = d3.extent(points, function(d, i){ return y.call(rectbin, d, i) ;});

      // debugger
      // console.log(`d3.range(${yExtent[0]}, ${yExtent[1]}, ${dy}): ${d3.range(yExtent[0], yExtent[1], dy)}`)
      d3.range(yExtent[0], yExtent[1] + dy, dx).forEach(function(Y){
        d3.range(xExtent[0], xExtent[1] + dx, dx).forEach(function(X){
          // console.log('XY', X, Y)
          var py = Y / dy;
          var pj = trunc(py);
          var px = X / dx;
          var pi = trunc(px);
          // debugger
          var id = pi + '-' + pj;
          var bin = binsById[id] = [];
          bin.i = pi;
          bin.j = pj;
          bin.x = pi * dx;
          bin.y = pj * dy;
        });
      });
      points.forEach(function(point, i) {
        var py = y.call(rectbin, point, i) / dy;
        var pj = trunc(py);
        var px = x.call(rectbin, point, i) / dx;
        var pi = trunc(px);

        var id = pi + '-' + pj;
        var bin = binsById[id];
        try {
          bin.push(point);
        } catch(e) {
          console.log(e)
          // debugger
        }
      });
      return d3.values(binsById);
    }

    rectbin.x = function(_) {
      if (!arguments.length) return x;
      x = _;
      return rectbin;
    };

    rectbin.y = function(_) {
      if (!arguments.length) return y;
      y = _;
      return rectbin;
    };

    rectbin.dx = function(_) {
      if (!arguments.length) return dx;
      dx = _;
      return rectbin;
    };

    rectbin.dy = function(_) {
      if (!arguments.length) return dy;
      dy = _;
      return rectbin;
    };


    return rectbin;
  };

  var rectbinX = function(d) { return d[0]; },
      rectbinY = function(d) { return d[1]; };

})();

function trunc(x) {
  return x < 0 ? Math.ceil(x) : Math.floor(x);
}
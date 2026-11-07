/* 3D-колибри с логотипа Fenix Flowers: зависает у роз, перелетает между цветками, на прокрутке улетает вверх. Чистый WebGL, без библиотек. */
(function () {
  var cv = document.getElementById('hb');
  var gl = cv && (cv.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true }) || cv.getContext('experimental-webgl'));
  if (!gl) { document.documentElement.classList.add('no-gl'); window.KB = { scroll: function () {}, live: function () {} }; return; }
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var PI = Math.PI;

  /* ---------- математика ---------- */
  function mul(a, b) { var o = new Float32Array(16); for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; }
  function ident() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
  function trans(x, y, z) { var m = ident(); m[12] = x; m[13] = y; m[14] = z; return m; }
  function scl(x, y, z) { var m = ident(); m[0] = x; m[5] = y; m[10] = z; return m; }
  function rotX(a) { var c = Math.cos(a), s = Math.sin(a), m = ident(); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }
  function rotY(a) { var c = Math.cos(a), s = Math.sin(a), m = ident(); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
  function rotZ(a) { var c = Math.cos(a), s = Math.sin(a), m = ident(); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }
  function persp(fov, asp, n, f) { var t = 1 / Math.tan(fov / 2), m = new Float32Array(16); m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f); return m; }
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function lookAt(e, t) { var z = norm([e[0] - t[0], e[1] - t[1], e[2] - t[2]]), x = norm(cross([0, 1, 0], z)), y = cross(z, x); return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]); }
  function basis(d) { var y = norm(d), up = Math.abs(y[2]) < .9 ? [0, 0, 1] : [1, 0, 0], x = norm(cross(up, y)), z = cross(x, y); return new Float32Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, 0, 0, 0, 1]); }
  function chain() { var m = arguments[0]; for (var i = 1; i < arguments.length; i++) m = mul(m, arguments[i]); return m; }

  /* ---------- геометрия ---------- */
  function Geo() { this.d = []; }
  Geo.prototype.surf = function (F, nu, nv, M) { // F(u,v) -> [x,y,z,m], нормали по разностям
    M = M || ident(); var P = [], i, j, e = 1e-3;
    for (j = 0; j <= nv; j++) for (i = 0; i <= nu; i++) {
      var u = i / nu, v = j / nv, p = F(u, v), pu = F(Math.min(1, u + e), v), pu2 = F(Math.max(0, u - e), v), pv = F(u, Math.min(1, v + e)), pv2 = F(u, Math.max(0, v - e));
      var n = cross([pu[0] - pu2[0], pu[1] - pu2[1], pu[2] - pu2[2]], [pv[0] - pv2[0], pv[1] - pv2[1], pv[2] - pv2[2]]);
      if (!(n[0] || n[1] || n[2])) n = [0, 1, 0];
      P.push([p, norm(n)]);
    }
    var w = nu + 1;
    for (j = 0; j < nv; j++) for (i = 0; i < nu; i++) {
      var a = P[j * w + i], b = P[j * w + i + 1], c = P[(j + 1) * w + i + 1], d = P[(j + 1) * w + i];
      this.tri(a, b, c, M); this.tri(a, c, d, M);
    }
  };
  Geo.prototype.tri = function () {
    var M = arguments[3], self = this;
    for (var k = 0; k < 3; k++) {
      var q = arguments[k], p = q[0], n = q[1];
      self.d.push(M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14],
        M[0] * n[0] + M[4] * n[1] + M[8] * n[2], M[1] * n[0] + M[5] * n[1] + M[9] * n[2], M[2] * n[0] + M[6] * n[1] + M[10] * n[2], p[3]);
    }
  };
  Geo.prototype.upload = function () {
    var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.d), gl.STATIC_DRAW);
    var n = this.d.length / 7; this.d = null; return { b: b, n: n };
  };

  /* лепесток: растёт вдоль y, края загибаются к центру цветка, кончик отгибается наружу */
  function petal(g, o) {
    var F = function (u, v) {
      var s = u * 2 - 1, w = o.w * Math.pow(Math.sin(PI * (.08 + .86 * v)), o.sh || .6);
      var x = s * w, y = o.l * v, z = -o.cup * s * s * w + o.curl * v * v * v * o.l;
      y -= o.tipDip ? o.tipDip * s * s * v * v : 0;
      return [x, y, z, o.m === undefined ? v : o.m];
    };
    g.surf(F, o.nu || 7, o.nv || 8, chain(rotY(o.a), trans(0, o.y || 0, o.r), rotX(o.t)));
  }
  function disc(g, r, h, m, M) { // приплюснутая полусфера: серединка, чашелистик
    g.surf(function (u, v) { var a = u * 2 * PI, b = v * PI / 2; return [Math.cos(a) * Math.cos(b) * r, Math.sin(b) * h, Math.sin(a) * Math.cos(b) * r, m]; }, 18, 5, M);
  }

  /* роза: тугой бутон внутри, раскрытые лепестки снаружи */
  var rose = new Geo(), GA = 2.39996;
  [[5, .14, .32, .5, .2, .25, .02], [5, .45, .42, .62, .3, .4, .06], [6, .8, .52, .72, .38, .5, .12], [6, 1.12, .6, .76, .44, .55, .22]].forEach(function (L, li) {
    for (var k = 0; k < L[0]; k++) petal(rose, { a: k / L[0] * 2 * PI + li * .7, t: L[1], w: L[2], l: L[3], r: L[4] * .35, cup: L[5], curl: L[6], y: -li * .05 });
  });
  disc(rose, .34, -.28, .1, ident());
  var roseB = rose.upload();

  /* кустовая роза: маленькая и раскрытая */
  var spray = new Geo();
  [[5, .5, .3, .4, .2, .35, .05], [6, 1.0, .36, .46, .3, .3, .15]].forEach(function (L, li) {
    for (var k = 0; k < L[0]; k++) petal(spray, { a: k / L[0] * 2 * PI + li * .6, t: L[1], w: L[2], l: L[3], r: L[4] * .3, cup: L[5], curl: L[6] });
  });
  disc(spray, .2, -.18, .1, ident());
  var sprayB = spray.upload();

  /* хризантема-ромашка: серединка и два ряда узких лепестков */
  var daisy = new Geo();
  [[18, 1.25, .1, .78, .02], [16, 1.5, .09, .7, .1]].forEach(function (L, li) {
    for (var k = 0; k < L[0]; k++) petal(daisy, { a: (k + li * .5) / L[0] * 2 * PI, t: L[1], w: L[2], l: L[3], r: .18, cup: .5, curl: L[4], sh: .45, nu: 3, nv: 6, y: .04 - li * .03 });
  });
  disc(daisy, .24, .14, 2, trans(0, .02, 0));
  var daisyB = daisy.upload();

  /* лист эвкалипта/зелени */
  var leaf = new Geo();
  petal(leaf, { a: 0, t: 0, w: .26, l: 1.25, r: 0, cup: .25, curl: .25, sh: .9, nv: 9 });
  var leafB = leaf.upload();

  /* обёртка: два слоя бумаги с волнистым краем, спереди ниже, чтобы цветы были видны */
  function wrapGeo(rot, lift, waves, m) {
    var g = new Geo();
    g.surf(function (u, v) {
      var a = u * 2 * PI, t = v;
      var front = Math.max(0, Math.cos(a - PI / 2 + rot));
      var top = .55 + lift - 1.0 * front * front + .16 * Math.sin(a * waves);
      var y = -3.3 + (top + 3.3) * t;
      var r = (.32 + Math.pow(t, 1.25) * .98) * (1 + .05 * Math.sin(a * waves + 1) * t);
      return [Math.cos(a) * r, y, Math.sin(a) * r, m + t * .9];
    }, 72, 14);
    return g.upload();
  }
  var wrapA = wrapGeo(0, 0, 5, 0), wrapB = wrapGeo(.5, .22, 4, 0);
  var ribbon = new Geo();
  ribbon.surf(function (u, v) { var a = u * 2 * PI, b = v * 2 * PI, R = .52, r = .07; return [Math.cos(a) * (R + Math.cos(b) * r), Math.sin(b) * r * 1.6, Math.sin(a) * (R + Math.cos(b) * r), 2]; }, 40, 8);
  [-1, 1].forEach(function (s) { // хвосты ленты
    ribbon.surf(function (u, v) { var x = s * (.1 + v * .5), y = -v * 1.2, z = .55 + Math.sin(v * 3) * .08; return [x + (u - .5) * .22, y, z + (u - .5) * .02 * s, 2]; }, 2, 8);
  });
  var ribbonB = ribbon.upload();
  var stem = new Geo();
  stem.surf(function (u, v) { var a = u * 2 * PI; return [Math.cos(a) * .05, -v * 1.1, Math.sin(a) * .05, .5]; }, 8, 1);
  var stemB = stem.upload();
  /* ---------- шейдер ---------- */
  var VS = 'attribute vec3 aP;attribute vec3 aN;attribute float aM;uniform mat4 uVP;uniform mat4 uW;varying vec3 vW;varying vec3 vN;varying float vM;' +
    'void main(){vec4 w=uW*vec4(aP,1.);vW=w.xyz;vN=mat3(uW[0].xyz,uW[1].xyz,uW[2].xyz)*aN;vM=aM;gl_Position=uVP*w;}';
  var FS = 'precision mediump float;varying vec3 vW;varying vec3 vN;varying float vM;uniform vec3 uC1;uniform vec3 uC2;uniform vec3 uE;uniform float uFade;uniform float uGl;uniform float uIr;' +
    'void main(){vec3 N=normalize(vN);vec3 V=normalize(uE-vW);if(dot(N,V)<0.)N=-N;' +
    'vec3 base=vM<1.5?uC1*mix(.6,1.,smoothstep(0.,.95,vM)):uC2;' +
    'float f=1.-max(dot(N,V),0.);base=mix(base,base.zxy*1.1+vec3(.05,.0,.1),uIr*f*f);' + // перелив перьев
    'vec3 L1=normalize(vec3(-.5,.8,.7));vec3 L2=normalize(vec3(.85,.15,.45));' +
    'float d1=max(0.,dot(N,L1)*.62+.38);float d2=max(0.,dot(N,L2))*.3;' +
    'float rim=pow(f,2.4);float sp=pow(max(dot(N,normalize(L1+V)),0.),60.)*uGl;' +
    'vec3 c=base*(.3+d1*.74+d2)+vec3(sp)+mix(vec3(1.,.95,.98),base,.4)*rim*(.12+uGl*.2);' +
    'gl_FragColor=vec4(min(c,vec3(1.))*uFade,uFade);}';
  function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(o)); return o; }
  var pg = gl.createProgram(); gl.attachShader(pg, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pg, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pg);
  var A = { p: gl.getAttribLocation(pg, 'aP'), n: gl.getAttribLocation(pg, 'aN'), m: gl.getAttribLocation(pg, 'aM') };
  var U = {}; ['uVP', 'uW', 'uC1', 'uC2', 'uE', 'uFade', 'uGl', 'uIr'].forEach(function (n) { U[n] = gl.getUniformLocation(pg, n); });
  gl.useProgram(pg); gl.enable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 0);
  [A.p, A.n, A.m].forEach(function (l) { gl.enableVertexAttribArray(l); });
  function draw(buf, W, c1, c2, gloss, ir) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.b);
    gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 28, 0); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, 28, 12); gl.vertexAttribPointer(A.m, 1, gl.FLOAT, false, 28, 24);
    gl.uniformMatrix4fv(U.uW, false, W); gl.uniform3fv(U.uC1, c1); gl.uniform3fv(U.uC2, c2 || c1); gl.uniform1f(U.uGl, gloss || 0); gl.uniform1f(U.uIr, ir || 0);
    gl.drawArrays(gl.TRIANGLES, 0, buf.n);
  }

  /* ---------- тела ---------- */
  var sph = new Geo();
  sph.surf(function (u, v) { var a = u * 2 * PI, b = v * PI; return [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a), .95]; }, 24, 16);
  var sphB = sph.upload();
  var cyl = new Geo(); // вдоль y от 0 до -1, сужается к концу
  cyl.surf(function (u, v) { var a = u * 2 * PI, r = 1 - v * .85; return [Math.cos(a) * r, -v, Math.sin(a) * r, .95]; }, 10, 4);
  var coneB = cyl.upload();
  var tube = new Geo();
  tube.surf(function (u, v) { var a = u * 2 * PI; return [Math.cos(a), -v, Math.sin(a), .6]; }, 8, 1);
  var tubeB = tube.upload();
  var feather = new Geo(); // перо: плоское, вытянутое, с закруглённым концом
  feather.surf(function (u, v) { var s = u * 2 - 1, w = .5 * Math.pow(Math.sin(PI * (.05 + .9 * v)), .5) * (1 - .35 * v); return [s * w, v, -.08 * s * s + .06 * v * v, .4 + v * .6]; }, 4, 10);
  var featherB = feather.upload();

  var COL = { rose: [.93, .45, .62], roseL: [.98, .72, .8], peach: [.99, .78, .66], white: [.98, .96, .95], green: [.28, .5, .36], euc: [.5, .66, .58], stem: [.33, .5, .32],
    back: [.12, .56, .5], belly: [.88, .9, .86], throat: [.86, .2, .45], wing: [.22, .34, .36], tail: [.1, .3, .3], beak: [.06, .05, .06], yolk: [.95, .8, .4] };

  /* цветы: три розы и кустовая веточка на стеблях */
  var FL = [
    { p: [-1.15, -.2, .2], d: norm([.45, 1, .55]), b: roseB, c: COL.rose, s: 1.15 },
    { p: [.35, -1.05, .5], d: norm([.2, 1, .7]), b: roseB, c: COL.roseL, s: 1.0 },
    { p: [-2.15, -1.35, -.3], d: norm([-.2, 1, .5]), b: roseB, c: COL.peach, s: .95 },
    { p: [-.6, -1.75, 1.0], d: norm([.1, .8, 1]), b: sprayB, c: COL.white, s: 1.2 }
  ];
  var BASE = [-.9, -5.5, .2];

  /* матрица «смотреть вперёд вдоль f» (ось z птицы) */
  function face(f) { var z = norm(f), x = norm(cross([0, 1, 0], z)), y = cross(z, x); return new Float32Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, 0, 0, 0, 1]); }
  function lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function hoverAt(i) { var f = FL[i], c = [f.p[0] + f.d[0] * .3, f.p[1] + f.d[1] * .3, f.p[2] + f.d[2] * .3]; return [c[0] + 1.62, c[1] + .5, c[2] + .55]; }
  function aimAt(i, p) { var f = FL[i]; return [f.p[0] + f.d[0] * .3 - p[0], (f.p[1] + f.d[1] * .3 - p[1]) * .35, f.p[2] + f.d[2] * .3 - p[2]]; }

  /* ---------- кадр ---------- */
  var W = 0, H = 0, live = true, last = 0, time = 0, mx = 0, my = 0, tmx = 0, tmy = 0, fade = 0, scr = 0, scrT = 0;
  var ORDER = [0, 1, 0, 3], cur = 0, nxt = 0, legT = 1, hold = 0;
  var pos = [5.5, 2.2, 1], vel = [0, 0, 0], look = [-1, 0, 0];
  function resize() {
    var r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    gl.viewport(0, 0, W, H);
  }
  addEventListener('resize', function () { resize(); kick(); });
  if (matchMedia('(hover:hover)').matches) addEventListener('pointermove', function (e) { tmx = e.clientX / innerWidth - .5; tmy = e.clientY / innerHeight - .5; }, { passive: true });

  function step(dt) {
    var k = 1 - Math.exp(-dt * 5);
    fade += (1 - fade) * (1 - Math.exp(-dt * 3));
    mx += (tmx - mx) * k; my += (tmy - my) * k; scr += (scrT - scr) * k;
    if (reduce) { pos = hoverAt(0); look = norm(aimAt(0, pos)); return; }
    hold -= dt;
    if (hold <= 0) { cur = (cur + 1) % ORDER.length; hold = 3.2 + (cur % 2) * 1.4; }
    var fi = ORDER[cur], tg = hoverAt(fi);
    tg = [tg[0] + mx * .9 + Math.sin(time * .9) * .08, tg[1] - my * .5 + Math.sin(time * 3.1) * .06 + scr * 5, tg[2] + Math.cos(time * .7) * .06];
    var ax = 0; for (var i = 0; i < 3; i++) { var a = (tg[i] - pos[i]) * 14 - vel[i] * 7; vel[i] += a * dt; pos[i] += vel[i] * dt; ax += vel[i] * vel[i]; }
    var speed = Math.sqrt(ax), f = FL[fi];
    var want = speed > .9 ? [vel[0], vel[1] * .3, vel[2]] : aimAt(fi, pos);
    if (scr > .15) want = [-.4, .5, .6];
    look = norm(lerp(look, norm(want), 1 - Math.exp(-dt * 6)));
  }
  function render() {
    if (!W) resize();
    var asp = W / H, d = 12.5 * Math.max(1, .95 / asp);
    var az = .32 + (reduce ? 0 : Math.sin(time * .25) * .06), el = .16, tg = [.15, -.1, 0];
    var eye = [Math.sin(az) * Math.cos(el) * d, tg[1] + Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d];
    var VP = mul(persp(.5, asp, 1, 80), lookAt(eye, tg));
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(U.uVP, false, VP); gl.uniform3f(U.uE, eye[0], eye[1], eye[2]); gl.uniform1f(U.uFade, fade);

    /* цветы, стебли, листья; розы чуть покачиваются */
    FL.forEach(function (f, i) {
      var sw = reduce ? 0 : Math.sin(time * .8 + i * 1.7) * .03, p = [f.p[0] + sw, f.p[1], f.p[2]];
      var top = [p[0] - f.d[0] * .35 * f.s, p[1] - f.d[1] * .35 * f.s, p[2] - f.d[2] * .35 * f.s];
      var dv = [top[0] - BASE[0], top[1] - BASE[1], top[2] - BASE[2]], L = Math.hypot(dv[0], dv[1], dv[2]);
      draw(tubeB, chain(trans(top[0], top[1], top[2]), basis(dv), scl(.05, L, .05)), COL.stem);
      for (var j = 0; j < 2; j++) { var t = .3 + j * .25, q = [top[0] - dv[0] * t, top[1] - dv[1] * t, top[2] - dv[2] * t], sd = (i + j) % 2 ? 1 : -1;
        draw(leafB, chain(trans(q[0], q[1], q[2]), basis([sd * .9, .7, .35]), scl(.62, .62, .62)), j ? COL.euc : COL.green); }
      draw(f.b, chain(trans(p[0], p[1], p[2]), basis(f.d), rotY(i * 1.3), scl(f.s, f.s, f.s)), f.c, COL.yolk, .15);
    });

    /* колибри */
    var B = chain(trans(pos[0], pos[1], pos[2]), face(look), rotX(-.38), scl(.95, .95, .95));
    draw(sphB, chain(B, scl(.27, .3, .62)), COL.back, null, 1.1, .8);
    draw(sphB, chain(B, trans(0, -.08, .05), scl(.22, .22, .5)), COL.belly, null, .3);
    draw(sphB, chain(B, trans(0, .14, .55), scl(.24, .23, .25)), COL.back, null, 1.1, .8);
    draw(sphB, chain(B, trans(0, .03, .62), scl(.17, .13, .16)), COL.throat, null, 1.4, .6);
    [-1, 1].forEach(function (s) { draw(sphB, chain(B, trans(s * .17, .2, .7), scl(.045, .045, .045)), COL.beak, null, 1.5); });
    draw(coneB, chain(B, trans(0, .13, .74), basis([0, .05, -1]), scl(.035, .82, .035)), COL.beak, null, 1);
    for (var t = 0; t < 5; t++) { var a = (t - 2) * .28; draw(featherB, chain(B, trans(0, -.02, -.5), basis([Math.sin(a) * .6, .05, -1]), scl(.32, .72, .32)), COL.tail, null, .6, .5); }
    var flap = reduce ? .3 : Math.sin(time * 34) * 1.05;
    [-1, 1].forEach(function (s) {
      var Wm = chain(B, trans(s * .18, .18, .18), rotZ(s * flap), rotY(s * -.25), basis([s, .25, -.15]), scl(.55, 1.45, .55));
      draw(featherB, Wm, COL.wing, null, .8, .7);
      draw(featherB, chain(Wm, rotZ(s * -.08), scl(.85, .8, .85)), COL.back, null, .8, .9);
    });
  }
  function frame_(now) {
    var dt = Math.min(.05, (now - last) / 1000 || .016); last = now; time += dt;
    step(dt); render();
    if (live) requestAnimationFrame(frame_);
  }
  var pending = false;
  function kick() {
    if (!reduce || pending) return; pending = true;
    requestAnimationFrame(function () { pending = false; step(.05); render(); });
  }
  window.KB = {
    scroll: function (p) { scrT = Math.max(0, Math.min(1, p)); kick(); },
    live: function (v) { if (reduce || v === live) return; live = v; if (v) { last = performance.now(); requestAnimationFrame(frame_); } }
  };
  resize();
  if (reduce) { live = false; fade = 1; kick(); } else requestAnimationFrame(frame_);
})();

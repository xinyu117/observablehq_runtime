
export function constructTangleLayout(levels, options = {}) {
  // 为节点添加level属性
  levels.forEach((l, i) => l.forEach(n => { n.level = i; n.bundles = [] })); // 1.forEach不返回新数组；2.箭头函数可以访问父级变量；3.遍历二维数组中的全部元素/节点

  // 取得全部节点数组
  var nodes = levels.reduce((a, x) => a.concat(x), []);  // 1.降维,二维转一维；2.把全部节点放入nodes中，方便以后使用；
  // 全部节点的MAP 1.数组转map；2.也可用这个方法：https://www.30secondsofcode.org/js/s/objectify/
  var nodes_index = {};
  nodes.forEach(d => (nodes_index[d.id] = d));

  const links = []; //全部连接
  levels.forEach((l, i) => {
    const bundles_index = {};
    l.filter(n => n.parents.length > 0)
      // .map(n => ({ id: n.parents.map(d => d.id).sort().join('-X-'), toword_parents: new Set(n.parents.slice()), level: i, span: i - d3.min(n.parents, p => p.level) }) )
      .forEach(n => {
        const id = n.parents.map(d => d.id).sort().join('-X-');

        if (!bundles_index[id]) {
          bundles_index[id] = { id: id, links: [], toword_parents: new Set(n.parents.slice()), level: i, span: i - d3.min(n.parents, p => p.level) }; // span:节点的level和父节点中level最小的差
        }

        n.bundle = bundles_index[id]; //节点对应的线束
        const linksOfNode = n.parents.map(p => ({ source: n, bundle: n.bundle, target: p })); //节点与父节点的连接
        bundles_index[id].links.push(...linksOfNode); //一个线束拥有的连接。
        links.push(...linksOfNode);
      });
    l.bundles = Object.keys(bundles_index).map(k => bundles_index[k]); //一个level有多少个线束; 把对象转换成数组
    l.bundles.forEach((b, i) => (b.i = i)); //给level内线束编号
  })
  // 全部线束
  var bundles = levels.reduce((a, x) => a.concat(x.bundles), []);

  // 一个父节点有那些线束
  bundles.forEach(b =>
    b.toword_parents.forEach(p => {
      if (p.bundles === undefined) {
        p.bundles = [];
      }
      p.bundles.push({ ...b }); //同一线束可能属于不同的父节点，以下对线束排序时会出现覆盖的情况，所以要拷贝一份
    })
  );

  nodes.forEach(n => {
    n.bundles.sort((a, b) => d3.descending(a.span, b.span)); //按跨越的level的个数排序
    n.bundles.forEach((b, index) => (b.jj = index));
  });



  // layout
  const padding = options.padding ?? 8;
  const node_height = options.node_height ?? 22;
  const node_width = options.node_width ?? 70;
  const bundle_width = options.bundle_width ?? 14;
  const level_y_padding = options.level_y_padding ?? 16;
  const metro_d = options.metro_d ?? 4;
  const min_family_height = options.min_family_height ?? node_height;

  options.c ||= 16;
  const c = options.c;
  options.bigc ||= node_width + c;

  nodes.forEach(
    n => (n.height = (Math.max(1, n.bundles.length) - 1) * metro_d) //节点的高度：根据线束的个数
  );

  // 节点XY的值算出
  var x_offset = padding;
  var y_offset = padding;
  levels.forEach(l => {
    x_offset += l.bundles.length * bundle_width + 12; //线束之间是错开的，suchao: 12
    y_offset += level_y_padding;
    l.forEach((n, i) => {
      n.x = n.level * node_width + x_offset;
      n.y = node_height + y_offset + n.height / 2;
      y_offset += node_height + n.height + 10;  //suchao:10
    });
  });


  var i = 0;
  levels.forEach(l => {
    l.bundles.forEach(b => {
      b.x = d3.max(b.toword_parents, d => d.x) + node_width + (l.bundles.length - 1 - b.i) * bundle_width;   // 线束上段终点的X值：根据以上父节点X的值算出；这个X比Target的x少一个bundle_width
      b.y = i * node_height;
    });
    i += l.length;
  });

  links.forEach(l => {
    l.xt = l.target.x; //线束上段起点的X值：target节点的X值
    l.yt =
      l.target.y +
      l.target.bundles.find((obj) => obj.id === l.bundle.id).jj * metro_d -
      (l.target.bundles.length * metro_d) / 2 +
      metro_d / 2;
    l.xb = l.bundle.x; //线束上段终点的X值，以上的b.x
    l.yb = l.bundle.y;
    l.xs = l.source.x; //线束下段终点的X值：source节点的X值
    l.ys = l.source.y;
  });

  // compress vertical space 压缩垂直方向空间，如果不压缩level间的Y是依次递增的，压缩后level间有重合的部分；以下计算可以保证：source节点不会高于target节点
  var y_negative_offset = 0;
  levels.forEach(l => {
    y_negative_offset += -min_family_height +
      d3.min(l.bundles, b =>
        d3.min(b.links, link => link.ys - 2 * c - (link.yt + c))
      ) || 0;
    l.forEach(n => (n.y -= y_negative_offset));
  });

  // very ugly, I know
  links.forEach(l => {
    l.yt =
      l.target.y +
      l.target.bundles.find((obj) => obj.id === l.bundle.id).jj * metro_d -
      (l.target.bundles.length * metro_d) / 2 +
      metro_d / 2;
    l.ys = l.source.y;
    l.c1 = l.source.level - l.target.level > 1 ? Math.min(options.bigc, l.xb - l.xt, l.yb - l.yt) - c : c;
    l.c2 = c;
  });

  var layout = {
    width: d3.max(nodes, n => n.x) + node_width + 2 * padding,
    height: d3.max(nodes, n => n.y) + node_height / 2 + 2 * padding,
    node_height,
    node_width,
    bundle_width,
    level_y_padding,
    metro_d
  };

  return { levels, nodes, nodes_index, links, bundles, layout };
}
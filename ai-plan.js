(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./geometry.js'));
  } else {
    root.ContourAIPlan = factory(root.ContourCore);
  }
})(globalThis, function (geometry) {
  'use strict';

  const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

  function readName(value, fallback, limit, place) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || value.trim().length > limit) {
      throw new Error(place + 'の名前は' + limit + '文字以内の文字列にしてください。');
    }
    return value.trim() || fallback;
  }

  function height(value, place) {
    if (!inRange(value, -100, 200)) throw new Error(place + 'の高さを−100〜200 mの数値にしてください。');
    return value;
  }

  function read(plan, imageSize) {
    if (plan?.schema !== 'contourdesigner.ai-plan' || plan.version !== 1) {
      throw new Error('AI等高線用のJSON（contourdesigner.ai-plan、version 1）を選んでください。');
    }
    if (!positiveInteger(plan.imageSize?.width) || !positiveInteger(plan.imageSize?.height)) {
      throw new Error('imageSize に元画像の幅 width と高さ height をピクセル単位の整数で指定してください。');
    }
    const { width, height: imageHeight } = imageSize;
    if (width !== plan.imageSize.width || imageHeight !== plan.imageSize.height) {
      throw new Error('画像サイズが違います。開いている下図は ' + width + ' × ' + imageHeight +
        ' px、AIの設計は ' + plan.imageSize.width + ' × ' + plan.imageSize.height + ' px です。対応する下図を開いてください。');
    }

    const { contours = [], pins = [], baseHeight = 0 } = plan;
    if (!Array.isArray(contours) || !Array.isArray(pins) || contours.length > 32 || pins.length > 64) {
      throw new Error('contours は32本まで、pins は64点までの配列にしてください。');
    }
    if (contours.length + pins.length === 0) throw new Error('等高線または高さの点を1件以上指定してください。');

    const lines = contours.map((line, index) => {
      const place = '等高線' + (index + 1);
      if (!line || typeof line !== 'object') throw new Error(place + ' の内容を確認してください。');
      const { closed = true, smooth = 0.4 } = line;
      if (typeof closed !== 'boolean' || !inRange(smooth, 0, 1)) {
        throw new Error(place + ' の closed は true / false、smooth は0〜1の数値で指定してください。');
      }
      const min = closed ? 3 : 2;
      if (!Array.isArray(line.points) || line.points.length < min || line.points.length > 96) {
        throw new Error(place + ' に' + min + '〜96個の座標ペア [x, y] を指定してください。');
      }
      const points = line.points.map((pair, pointIndex) => {
        if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(v => inRange(v, 0, 1))) {
          throw new Error(place + ' の' + (pointIndex + 1) + '点目は、左上を原点とする0〜1の [x, y] で指定してください。');
        }
        return { x: pair[0], y: pair[1] };
      });
      return {
        id: 'ai-line-' + (index + 1), name: readName(line.name, place, 60, place),
        height: height(line.height, place), closed, smooth, points
      };
    });

    const spots = pins.map((pin, index) => {
      const place = '高さの点' + (index + 1);
      if (!inRange(pin?.x, 0, 1) || !inRange(pin?.y, 0, 1)) {
        throw new Error(place + ' の x・y は0〜1の数値で指定してください。');
      }
      return {
        id: 'ai-pin-' + (index + 1), name: readName(pin.name, place, 60, place),
        height: height(pin.height, place), x: pin.x, y: pin.y
      };
    });

    const issues = geometry.validate(lines, spots);
    if (issues.length) {
      const issue = issues[0];
      const affected = [...lines, ...spots].filter(item => issue.ids.includes(item.id)).map(item => item.name);
      throw new Error(affected.join('・') + '：' + issue.message);
    }
    return {
      name: readName(plan.name, '', 80, '設計'), baseHeight: height(baseHeight, '基準高'),
      contours: lines, pins: spots
    };
  }

  return { read };
});

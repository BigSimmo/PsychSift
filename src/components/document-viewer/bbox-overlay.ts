/**
 * Geometry calculator and validation for PDF crop-to-page visual bounding box overlays.
 *
 * Translates stored extraction bounding boxes (both 0..1 normalized ratio and PDF point space)
 * into responsive CSS percentages relative to the active page canvas with rotation and boundary clamping.
 */

export type PageGeometry = {
  width: number;
  height: number;
};

export type BboxOverlayStyle = {
  left: string;
  top: string;
  width: string;
  height: string;
};

/**
 * The page's size in the frame a stored point-space bbox is measured in.
 *
 * The viewer measures each page after the reader's rotation, so at 90° or 270°
 * its width and height are swapped. Stored bboxes are in the page's own frame,
 * before the reader rotated it, so dividing them by the swapped size would
 * misplace the box before the rotation transform below is even applied. Swap
 * the size back for quarter turns; half turns keep their dimensions.
 */
export function resolveBboxFrameGeometry(
  displayedGeometry: PageGeometry | null | undefined,
  rotation = 0,
): PageGeometry | null {
  if (!displayedGeometry) return null;
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  return normalizedRotation === 90 || normalizedRotation === 270
    ? { width: displayedGeometry.height, height: displayedGeometry.width }
    : displayedGeometry;
}

export function resolveBboxOverlayStyle({
  bbox,
  pageGeometry,
  rotation = 0,
}: {
  bbox: [number, number, number, number] | null | undefined;
  pageGeometry?: PageGeometry | null;
  rotation?: number;
}): BboxOverlayStyle | null {
  if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) {
    return null;
  }

  const [rawX0, rawY0, rawX1, rawY1] = bbox;

  if (!Number.isFinite(rawX0) || !Number.isFinite(rawY0) || !Number.isFinite(rawX1) || !Number.isFinite(rawY1)) {
    return null;
  }

  const minX = Math.min(rawX0, rawX1);
  const maxX = Math.max(rawX0, rawX1);
  const minY = Math.min(rawY0, rawY1);
  const maxY = Math.max(rawY0, rawY1);

  if (maxX <= minX || maxY <= minY) {
    return null;
  }

  let normX: number;
  let normY: number;
  let normW: number;
  let normH: number;

  // Determine whether coordinates are normalized [0..1] ratio or PDF points (e.g. 72dpi points)
  const isNormalizedRatio = minX >= 0 && minY >= 0 && maxX <= 1.01 && maxY <= 1.01;

  if (isNormalizedRatio) {
    normX = minX;
    normY = minY;
    normW = maxX - minX;
    normH = maxY - minY;
  } else {
    if (
      !pageGeometry ||
      !Number.isFinite(pageGeometry.width) ||
      !Number.isFinite(pageGeometry.height) ||
      pageGeometry.width <= 0 ||
      pageGeometry.height <= 0
    ) {
      return null;
    }
    normX = minX / pageGeometry.width;
    normY = minY / pageGeometry.height;
    normW = (maxX - minX) / pageGeometry.width;
    normH = (maxY - minY) / pageGeometry.height;
  }

  // Clamping to [0, 1] page boundaries
  normX = Math.max(0, Math.min(1, normX));
  normY = Math.max(0, Math.min(1, normY));
  normW = Math.max(0, Math.min(1 - normX, normW));
  normH = Math.max(0, Math.min(1 - normY, normH));

  // If the clamped dimension is zero/negligible, suppress overlay
  if (normW <= 0.001 || normH <= 0.001) {
    return null;
  }

  const normalizedRotation = (((rotation % 360) + 360) % 360) as 0 | 90 | 180 | 270;

  let leftPercent: number;
  let topPercent: number;
  let widthPercent: number;
  let heightPercent: number;

  switch (normalizedRotation) {
    case 90:
      leftPercent = (1 - normY - normH) * 100;
      topPercent = normX * 100;
      widthPercent = normH * 100;
      heightPercent = normW * 100;
      break;
    case 180:
      leftPercent = (1 - normX - normW) * 100;
      topPercent = (1 - normY - normH) * 100;
      widthPercent = normW * 100;
      heightPercent = normH * 100;
      break;
    case 270:
      leftPercent = normY * 100;
      topPercent = (1 - normX - normW) * 100;
      widthPercent = normH * 100;
      heightPercent = normW * 100;
      break;
    case 0:
    default:
      leftPercent = normX * 100;
      topPercent = normY * 100;
      widthPercent = normW * 100;
      heightPercent = normH * 100;
      break;
  }

  return {
    left: `${Number(leftPercent.toFixed(3))}%`,
    top: `${Number(topPercent.toFixed(3))}%`,
    width: `${Number(widthPercent.toFixed(3))}%`,
    height: `${Number(heightPercent.toFixed(3))}%`,
  };
}

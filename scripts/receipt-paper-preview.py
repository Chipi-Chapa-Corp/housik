"""Preview local MSER + GrabCut receipt crops. No OCR, API calls or GUI.

Requires opencv-python-headless, numpy and Pillow. Originals are preserved.
Run: .test-data/crop-env/bin/python scripts/receipt-paper-preview.py
"""
import json
from pathlib import Path
from time import perf_counter

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.test-data' / 'receipt-crops'
OUT.mkdir(parents=True, exist_ok=True)


def ordered(points):
    points = np.asarray(points, np.float32).reshape(4, 2)
    center = points.mean(axis=0)
    points = points[np.argsort(np.arctan2(points[:, 1] - center[1], points[:, 0] - center[0]))]
    return np.roll(points, -np.argmin(points.sum(axis=1)), axis=0)


def detect(image):
    scale = min(1.0, 800 / max(image.shape[:2]))
    small = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    detector = cv2.MSER_create()
    detector.setMinArea(5)
    detector.setMaxArea(350)
    regions, boxes = detector.detectRegions(gray)
    text = np.zeros_like(gray)
    for region, (x, y, w, h) in zip(regions, boxes):
        if not (2 <= w <= 28 and 4 <= h <= 22 and .15 < w / h < 2.2
                and .1 < len(region) / (w * h) < .9):
            continue
        if not 20 < gray[region[:, 1], region[:, 0]].mean() < 180:
            continue
        cv2.rectangle(text, (x, y), (x + w, y + h), 255, -1)

    candidates = []
    # Two generic grouping scales accommodate sparse and dense printed receipts.
    for kh, kw in [(51, 65), (121, 81)]:
        groups = cv2.dilate(text, np.ones((kh, kw), np.uint8))
        contours, _ = cv2.findContours(groups, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        hull = cv2.convexHull(max(contours, key=cv2.contourArea))
        area = np.zeros_like(gray)
        cv2.fillConvexPoly(area, hull, 255)
        seed = cv2.erode(area, np.ones((65, 65), np.uint8))
        if not np.any(seed):
            continue
        outer = cv2.dilate(area, np.ones((121, 121), np.uint8))
        labels = np.full(gray.shape, cv2.GC_PR_BGD, np.uint8)
        labels[outer == 0] = cv2.GC_BGD
        labels[area > 0] = cv2.GC_PR_FGD
        labels[seed > 0] = cv2.GC_FGD
        cv2.setRNGSeed(0)
        cv2.grabCut(small, labels, None, np.zeros((1, 65)), np.zeros((1, 65)),
                    5, cv2.GC_INIT_WITH_MASK)
        mask = np.uint8((labels == cv2.GC_FGD) | (labels == cv2.GC_PR_FGD)) * 255
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        contour = max(contours, key=cv2.contourArea)
        size = cv2.contourArea(contour)
        solidity = size / max(1, cv2.contourArea(cv2.convexHull(contour)))
        # Irregular merges often include a hand, clothing or the background.
        if solidity < .96 or size < gray.size * .1:
            continue
        candidates.append((size, contour, solidity, [kh, kw]))
    if not candidates:
        return None
    _, contour, solidity, grouping = max(candidates, key=lambda candidate: candidate[0])
    return contour.astype(np.float32) / scale, solidity, grouping


def crop(image, contour):
    hull = cv2.convexHull(contour)
    perimeter = cv2.arcLength(hull, True)
    for epsilon in [.01, .015, .02, .03, .04]:
        polygon = cv2.approxPolyDP(hull, epsilon * perimeter, True)
        if len(polygon) != 4:
            continue
        points = ordered(polygon)
        points = points.mean(axis=0) + (points - points.mean(axis=0)) * 1.04
        # Do not straighten when a quadrilateral would cut away curved paper.
        inside = sum(cv2.pointPolygonTest(points, tuple(map(float, p)), False) >= 0
                     for p in contour[:, 0]) / len(contour)
        if inside < .99:
            continue
        tl, tr, br, bl = points
        width = round(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
        height = round(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
        target = np.float32([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])
        transform = cv2.getPerspectiveTransform(points, target)
        result = cv2.warpPerspective(image, transform, (width, height), flags=cv2.INTER_CUBIC,
                                     borderMode=cv2.BORDER_REPLICATE)
        return result, 'perspective crop', points
    x, y, w, h = cv2.boundingRect(contour)
    margin = round(max(w, h) * .025)
    left, top = max(0, x - margin), max(0, y - margin)
    right, bottom = min(image.shape[1], x + w + margin), min(image.shape[0], y + h + margin)
    return image[top:bottom, left:right].copy(), 'crop; curved outline kept', None


try:
    FONT = ImageFont.truetype('/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf', 18)
except OSError:
    FONT = ImageFont.load_default(size=18)


def comparison(number, outlined, result, note):
    sheet = Image.new('RGB', (1040, 800), '#f5f5f5')
    draw = ImageDraw.Draw(sheet)
    draw.text((20, 12), f'Receipt {number} · {note}', fill='#333333', font=FONT)
    for x, source, title in [(20, outlined, 'Original + detected paper'), (540, result, 'Automatic crop')]:
        draw.text((x, 46), title, fill='#333333', font=FONT)
        preview = ImageOps.contain(source, (480, 700))
        sheet.paste(preview, (x + (480 - preview.width) // 2, 78 + (700 - preview.height) // 2))
    sheet.save(OUT / f'{number}-comparison.jpg', quality=95)


results = []
for number in (1, 2, 3):
    image = cv2.imread(str(ROOT / 'tests' / 'llm' / 'fixtures' / f'{number}.jpg'))
    started = perf_counter()
    detected = detect(image)
    outlined = image.copy()
    metadata = {}
    if detected:
        contour, solidity, grouping = detected
        result, status, points = crop(image, contour)
        cv2.drawContours(outlined, [contour.astype(np.int32)], -1, (50, 180, 50), 4)
        metadata = dict(solidity=round(solidity, 4), grouping=grouping,
                        corners=None if points is None else points.tolist())
    else:
        result = image.copy()
        status = 'no reliable outline; original retained'
    elapsed = (perf_counter() - started) * 1000
    cv2.imwrite(str(OUT / f'{number}-crop.jpg'), result, [cv2.IMWRITE_JPEG_QUALITY, 97])
    cv2.imwrite(str(OUT / f'{number}-boundary.jpg'), outlined, [cv2.IMWRITE_JPEG_QUALITY, 95])
    comparison(number, Image.fromarray(cv2.cvtColor(outlined, cv2.COLOR_BGR2RGB)),
               Image.fromarray(cv2.cvtColor(result, cv2.COLOR_BGR2RGB)), status)
    record = dict(receipt=number, status=status, processing_ms=round(elapsed, 1),
                  input_size=[image.shape[1], image.shape[0]], output_size=[result.shape[1], result.shape[0]],
                  **metadata)
    results.append(record)
    print(json.dumps(record))
(OUT / 'results.json').write_text(json.dumps(dict(opencv=cv2.__version__, results=results), indent=2))

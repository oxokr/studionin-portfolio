/**
 * extract-images.mjs
 * 각 프로젝트의 최종 매뉴얼 PDF에서 페이지별 이미지를 추출하고
 * 첫 번째 내용 페이지를 썸네일로, 나머지를 갤러리용으로 저장한다.
 *
 * 사용법: node scripts/extract-images.mjs [--limit N]
 * 출력: src/content/projects/[slug]/images/
 *
 * 의존성: pdftoppm (poppler), sips (macOS 내장)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 999;

const pdfs = JSON.parse(fs.readFileSync('data/accessible-pdfs.json', 'utf-8'));
const CONTENT_DIR = path.resolve('src/content/projects');

// 슬러그 매핑 — .md 파일에서 source 주석으로 매칭
function buildSlugMap() {
  const map = {};
  const files = fs.readdirSync(CONTENT_DIR).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const content = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf-8');
    const sourceMatch = content.match(/# source: (T[123])\/(.+?)\/(.+)/);
    const slugMatch = content.match(/^slug: '(.+)'/m);
    if (sourceMatch && slugMatch) {
      const key = (sourceMatch[2] + '/' + sourceMatch[3]).normalize('NFC');
      map[key] = slugMatch[1];
    }
  }
  return map;
}

const slugMap = buildSlugMap();

console.log('🖼  Extracting images from PDFs...\n');

let processed = 0;
let skipped = 0;

for (const entry of pdfs) {
  if (processed >= LIMIT) break;

  const key = (entry.org + '/' + entry.project).normalize('NFC');
  const slug = slugMap[key];

  if (!slug) {
    skipped++;
    continue;
  }

  const imgDir = path.join(CONTENT_DIR, slug, 'images');

  // 이미 추출된 경우 스킵
  if (fs.existsSync(imgDir) && fs.readdirSync(imgDir).length > 0) {
    skipped++;
    continue;
  }

  fs.mkdirSync(imgDir, { recursive: true });

  const pdfPath = entry.pdf;

  try {
    // pdftoppm으로 전체 페이지를 JPG로 렌더링 (300dpi → 웹용으로 충분)
    // 최대 20페이지까지
    execSync(
      `pdftoppm -jpeg -r 200 -l 20 "${pdfPath}" "${imgDir}/page"`,
      { timeout: 60000, stdio: 'pipe' }
    );

    // 생성된 파일 정리
    const pageFiles = fs.readdirSync(imgDir)
      .filter(f => f.startsWith('page-') && f.endsWith('.jpg'))
      .sort();

    if (pageFiles.length === 0) {
      console.log(`  ⚠ ${slug}: no pages extracted`);
      continue;
    }

    // 첫 페이지(표지) → 건너뛰고 두 번째 페이지를 썸네일로
    // 표지는 보통 로고+제목만이므로
    const thumbnailSource = pageFiles.length > 1 ? pageFiles[1] : pageFiles[0];

    // 썸네일 생성 (1200px 폭으로 리사이즈)
    const thumbSrc = path.join(imgDir, thumbnailSource);
    const thumbDst = path.join(imgDir, 'thumbnail.jpg');
    execSync(
      `sips -Z 1200 "${thumbSrc}" --out "${thumbDst}" 2>/dev/null`,
      { stdio: 'pipe' }
    );

    // 히어로 = 첫 내용 페이지 (같은 것)
    fs.copyFileSync(thumbDst, path.join(imgDir, 'hero.jpg'));

    // 갤러리용: 01-page.jpg, 02-page.jpg ... (표지 제외)
    const galleryPages = pageFiles.slice(1); // 표지(0) 제외
    for (let i = 0; i < galleryPages.length && i < 15; i++) {
      const src = path.join(imgDir, galleryPages[i]);
      const num = String(i + 1).padStart(2, '0');
      const dst = path.join(imgDir, `${num}-page.jpg`);

      // 1600px 폭으로 리사이즈
      execSync(
        `sips -Z 1600 "${src}" --out "${dst}" 2>/dev/null`,
        { stdio: 'pipe' }
      );
    }

    // 원본 page-*.jpg 삭제
    for (const f of pageFiles) {
      const fp = path.join(imgDir, f);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }

    const finalFiles = fs.readdirSync(imgDir);
    console.log(`  ✓ ${slug}: ${finalFiles.length} images`);
    processed++;

  } catch (err) {
    console.log(`  ✗ ${slug}: ${err.message?.substring(0, 60)}`);
    // 빈 디렉토리 정리
    try { fs.rmdirSync(imgDir); } catch {}
  }
}

console.log(`\n✅ 완료: ${processed}개 추출, ${skipped}개 스킵`);

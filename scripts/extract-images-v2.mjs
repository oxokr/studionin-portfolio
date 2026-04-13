/**
 * extract-images-v2.mjs
 * 개선된 이미지 추출: 포스터 PDF 우선, 시각적 복잡도 기반 썸네일 선택
 *
 * 썸네일 선택 기준:
 *   1. 포스터 PDF가 별도로 있으면 → 그 PDF의 가장 비주얼한 페이지
 *   2. 종합 매뉴얼에서 → 파일 크기가 큰 페이지 (= 이미지 밀도 높음 = 디자인 결과물)
 *   3. 표지(1페이지)와 소형 페이지(사양만 있는 것) 자동 제외
 *
 * 갤러리: 종합 매뉴얼에서 표지 제외한 전체 페이지, 크기 순 정렬
 *
 * 사용법: node scripts/extract-images-v2.mjs [--limit N] [--clean]
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 999;
const CLEAN = args.includes('--clean');

const sel = JSON.parse(fs.readFileSync('data/project-selections.json', 'utf-8'));
const CONTENT_DIR = path.resolve('src/content/projects');
const DROPBOX = '/Users/oxo/Library/CloudStorage/Dropbox-studionin';
const SOURCES = {
  T1: path.join(DROPBOX, 'studionin/project'),
  T2: path.join(DROPBOX, 'T2'),
  T3: path.join(DROPBOX, 'T3'),
};

// .md 파일에서 slug 매핑
function buildSlugMap() {
  const map = {};
  for (const file of fs.readdirSync(CONTENT_DIR).filter(f => f.endsWith('.md'))) {
    const content = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf-8');
    const src = content.match(/# source: (T[123])\/(.+?)\/(.+)/);
    const slug = content.match(/^slug: '(.+)'/m);
    if (src && slug) {
      map[(src[2] + '/' + src[3]).normalize('NFC')] = slug[1];
    }
  }
  return map;
}

// 매뉴얼 폴더의 모든 PDF 분류
function classifyPdfs(projPath) {
  const pdfs = { poster: [], main: [], other: [] };

  for (const manDir of ['매뉴얼', 'Manual']) {
    const manPath = path.join(projPath, manDir);
    if (!fs.existsSync(manPath)) continue;

    try {
      const files = fs.readdirSync(manPath)
        .filter(f => f.endsWith('.pdf'))
        .map(f => ({ name: f.normalize('NFC'), path: path.join(manPath, f) }));

      for (const f of files) {
        const n = f.name.toLowerCase();
        if (n.includes('포스터') && !n.includes('사인물') && !n.includes('무빙')) {
          pdfs.poster.push(f);
        } else if (
          (n.includes('매뉴얼') && !n.includes('사인물') && !n.includes('배너') &&
           !n.includes('버스') && !n.includes('가로등') && !n.includes('웹') &&
           !n.includes('명제표') && !n.includes('외부') && !n.includes('시공') &&
           !n.includes('리플') && !n.includes('전단') && !n.includes('현수막') &&
           !n.includes('에코백') && !n.includes('초청') && !n.includes('랩핑') &&
           !n.includes('기둥')) ||
          n.includes('브리프')
        ) {
          pdfs.main.push(f);
        } else {
          pdfs.other.push(f);
        }
      }
    } catch {}
  }

  // 각 카테고리에서 버전 높은 것 정렬
  const sortByVersion = (arr) => arr.sort((a, b) => {
    const va = (a.name.match(/v?(\d+(?:\.\d+)?)/i) || [0, 0])[1];
    const vb = (b.name.match(/v?(\d+(?:\.\d+)?)/i) || [0, 0])[1];
    return parseFloat(vb) - parseFloat(va);
  });

  sortByVersion(pdfs.poster);
  sortByVersion(pdfs.main);

  return pdfs;
}

// PDF를 페이지별 이미지로 렌더링, 파일 크기와 함께 반환
function renderPages(pdfPath, tmpDir, maxPages = 20) {
  try {
    execSync(
      `pdftoppm -jpeg -r 200 -l ${maxPages} "${pdfPath}" "${tmpDir}/p"`,
      { timeout: 60000, stdio: 'pipe' }
    );
  } catch { return []; }

  return fs.readdirSync(tmpDir)
    .filter(f => f.startsWith('p-') && f.endsWith('.jpg'))
    .sort()
    .map(f => {
      const fp = path.join(tmpDir, f);
      return { file: f, path: fp, size: fs.statSync(fp).size };
    });
}

// 가장 비주얼한 페이지 선택 (파일 크기 기준, 표지 제외)
function pickBestVisualPage(pages) {
  if (pages.length <= 1) return pages[0] || null;

  // 표지(첫 페이지) 제외
  const contentPages = pages.slice(1);
  if (contentPages.length === 0) return pages[0];

  // 평균 파일 크기
  const avgSize = contentPages.reduce((s, p) => s + p.size, 0) / contentPages.length;

  // 평균 이상인 페이지 중 가장 큰 것 = 가장 비주얼
  const candidates = contentPages.filter(p => p.size > avgSize * 0.8);
  candidates.sort((a, b) => b.size - a.size);

  return candidates[0] || contentPages[0];
}

// 갤러리용 페이지 정렬 (비주얼 순)
function sortGalleryPages(pages) {
  // 표지 제외
  const contentPages = pages.slice(1);

  // 너무 작은 페이지 (사양 텍스트만 있는 것) 제외: 평균의 30% 미만
  const avgSize = contentPages.reduce((s, p) => s + p.size, 0) / contentPages.length;
  const filtered = contentPages.filter(p => p.size > avgSize * 0.3);

  // 원래 순서 유지 (PDF 페이지 순서 = 디자이너가 의도한 순서)
  return filtered;
}

const slugMap = buildSlugMap();

console.log('🖼  Extracting images v2 (smart thumbnail selection)...\n');

let processed = 0, skipped = 0;

for (const s of sel) {
  if (processed >= LIMIT) break;

  const key = (s.orgName + '/' + s.projectName).normalize('NFC');
  const slug = slugMap[key];
  if (!slug) { skipped++; continue; }

  const imgDir = path.join(CONTENT_DIR, slug, 'images');

  // --clean이면 기존 이미지 삭제
  if (CLEAN && fs.existsSync(imgDir)) {
    fs.rmSync(imgDir, { recursive: true });
  }

  // 이미 있으면 스킵
  if (fs.existsSync(imgDir) && fs.readdirSync(imgDir).length > 2) {
    skipped++;
    continue;
  }

  const srcBase = SOURCES[s.source] || SOURCES.T1;
  const projPath = path.join(srcBase, s.orgName, s.projectName);
  const pdfs = classifyPdfs(projPath);

  if (pdfs.poster.length === 0 && pdfs.main.length === 0 && pdfs.other.length === 0) {
    skipped++;
    continue;
  }

  fs.mkdirSync(imgDir, { recursive: true });
  const tmpDir = path.join(imgDir, '_tmp');
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // === 썸네일 선택 ===
    let thumbnailPage = null;

    // 1순위: 포스터 PDF에서
    if (pdfs.poster.length > 0) {
      const posterPages = renderPages(pdfs.poster[0].path, tmpDir, 5);
      thumbnailPage = pickBestVisualPage(posterPages);
    }

    // 2순위: 종합 매뉴얼에서
    if (!thumbnailPage && pdfs.main.length > 0) {
      const mainPages = renderPages(pdfs.main[0].path, tmpDir, 20);
      thumbnailPage = pickBestVisualPage(mainPages);
    }

    // 3순위: 아무 PDF에서
    if (!thumbnailPage && pdfs.other.length > 0) {
      // 파일 크기가 큰 PDF 우선 (= 내용이 많음)
      pdfs.other.sort((a, b) => {
        try {
          return fs.statSync(b.path).size - fs.statSync(a.path).size;
        } catch { return 0; }
      });
      const otherPages = renderPages(pdfs.other[0].path, tmpDir, 10);
      thumbnailPage = pickBestVisualPage(otherPages);
    }

    // 썸네일 저장
    if (thumbnailPage) {
      execSync(`sips -Z 1200 "${thumbnailPage.path}" --out "${path.join(imgDir, 'thumbnail.jpg')}" 2>/dev/null`, { stdio: 'pipe' });
      fs.copyFileSync(path.join(imgDir, 'thumbnail.jpg'), path.join(imgDir, 'hero.jpg'));
    }

    // === 갤러리 이미지 ===
    // 종합 매뉴얼 사용 (이미 렌더링되어 있으면 재사용)
    let gallerySource = pdfs.main[0] || pdfs.poster[0] || pdfs.other[0];
    if (!gallerySource) { throw new Error('no PDF'); }

    // tmpDir에 이미 렌더링된 것 확인, 없으면 다시 렌더링
    let allPages = fs.readdirSync(tmpDir)
      .filter(f => f.startsWith('p-') && f.endsWith('.jpg'))
      .sort()
      .map(f => ({ file: f, path: path.join(tmpDir, f), size: fs.statSync(path.join(tmpDir, f)).size }));

    if (allPages.length === 0) {
      allPages = renderPages(gallerySource.path, tmpDir, 20);
    }

    const galleryPages = sortGalleryPages(allPages);

    for (let i = 0; i < galleryPages.length && i < 15; i++) {
      const num = String(i + 1).padStart(2, '0');
      execSync(
        `sips -Z 1600 "${galleryPages[i].path}" --out "${path.join(imgDir, num + '-page.jpg')}" 2>/dev/null`,
        { stdio: 'pipe' }
      );
    }

    // tmp 정리
    fs.rmSync(tmpDir, { recursive: true, force: true });

    const finalCount = fs.readdirSync(imgDir).filter(f => f.endsWith('.jpg')).length;
    console.log(`  ✓ ${slug}: ${finalCount} images (thumb: ${pdfs.poster.length > 0 ? 'poster PDF' : 'best visual'})`);
    processed++;

  } catch (err) {
    console.log(`  ✗ ${slug}: ${err.message?.substring(0, 60)}`);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    try { if (fs.readdirSync(imgDir).length === 0) fs.rmdirSync(imgDir); } catch {}
  }
}

console.log(`\n✅ 완료: ${processed}개 추출, ${skipped}개 스킵`);

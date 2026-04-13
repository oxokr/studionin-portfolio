/**
 * extract-images-v3.mjs
 * pdfimages로 PDF 내장 이미지를 직접 추출 (매뉴얼 양식 제거)
 *
 * 기존 pdftoppm은 페이지 전체를 캡처 → 양식 레이아웃 포함
 * pdfimages는 PDF 안에 임베드된 원본 이미지만 추출 → 순수 디자인 결과물
 *
 * 썸네일: 가장 큰 이미지 (= 포스터/목업 등 대표 비주얼)
 * 갤러리: 100KB 이상 이미지를 크기순 정렬
 *
 * 사용법: node scripts/extract-images-v3.mjs [--limit N]
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 999;

const sel = JSON.parse(fs.readFileSync('data/project-selections.json', 'utf-8'));
const PUBLIC_DIR = path.resolve('public/images/projects');
const CONTENT_DIR = path.resolve('src/content/projects');

const DROPBOX = '/Users/oxo/Library/CloudStorage/Dropbox-studionin';
const SOURCES = {
  T1: path.join(DROPBOX, 'studionin/project'),
  T2: path.join(DROPBOX, 'T2'),
  T3: path.join(DROPBOX, 'T3'),
};

// slug 매핑
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

// 모든 매뉴얼 PDF 경로 수집
function getAllPdfs(projPath) {
  const pdfs = [];
  for (const manDir of ['매뉴얼', 'Manual']) {
    const manPath = path.join(projPath, manDir);
    if (!fs.existsSync(manPath)) continue;
    try {
      const files = fs.readdirSync(manPath)
        .filter(f => f.endsWith('.pdf'))
        .map(f => path.join(manPath, f));
      pdfs.push(...files);
    } catch {}
  }
  return pdfs;
}

// PDF에서 이미지 추출
function extractImages(pdfPath, tmpDir) {
  try {
    execSync(`pdfimages -j "${pdfPath}" "${tmpDir}/img"`, {
      timeout: 60000, stdio: 'pipe'
    });
  } catch { return []; }

  const files = fs.readdirSync(tmpDir);
  const images = [];

  for (const f of files) {
    const fp = path.join(tmpDir, f);
    const ext = path.extname(f).toLowerCase();

    if (ext === '.ppm' || ext === '.pbm' || ext === '.pgm') {
      // PPM/PBM → JPG 변환
      const jpgPath = fp.replace(/\.\w+$/, '.jpg');
      try {
        execSync(`sips -s format jpeg "${fp}" --out "${jpgPath}" 2>/dev/null`, { stdio: 'pipe' });
        fs.unlinkSync(fp);
        const stat = fs.statSync(jpgPath);
        images.push({ path: jpgPath, size: stat.size, name: path.basename(jpgPath) });
      } catch {
        try { fs.unlinkSync(fp); } catch {}
      }
    } else if (ext === '.jpg' || ext === '.png') {
      const stat = fs.statSync(fp);
      images.push({ path: fp, size: stat.size, name: f });
    }
  }

  return images;
}

// 이미지 크기(dimensions) 확인
function getImageDimensions(imgPath) {
  try {
    const out = execSync(`sips -g pixelWidth -g pixelHeight "${imgPath}" 2>/dev/null`, { encoding: 'utf-8' });
    const w = parseInt(out.match(/pixelWidth:\s*(\d+)/)?.[1] || '0');
    const h = parseInt(out.match(/pixelHeight:\s*(\d+)/)?.[1] || '0');
    return { w, h };
  } catch { return { w: 0, h: 0 }; }
}

// 썸네일 선택: 가장 큰 이미지 중 적절한 비율인 것
function pickThumbnail(images) {
  // 100KB 이상, 가로 400px 이상인 이미지만
  const candidates = images.filter(img => {
    if (img.size < 100000) return false;
    const dim = getImageDimensions(img.path);
    return dim.w >= 400 && dim.h >= 300;
  });

  if (candidates.length === 0) return images[0] || null;

  // 파일 크기 순 (큰 것 = 고해상도 = 대표 이미지)
  candidates.sort((a, b) => b.size - a.size);
  return candidates[0];
}

// 갤러리 이미지 선택: 100KB 이상, 중복 제거
function pickGallery(images, thumbnailName) {
  return images
    .filter(img => {
      if (img.size < 80000) return false; // 아이콘/로고 제외
      if (img.name === thumbnailName) return false; // 썸네일 중복 제외
      const dim = getImageDimensions(img.path);
      return dim.w >= 300 && dim.h >= 200;
    })
    .sort((a, b) => b.size - a.size)
    .slice(0, 15); // 최대 15장
}

const slugMap = buildSlugMap();
console.log('🖼  v3: Extracting embedded images from PDFs...\n');

let processed = 0, skipped = 0;

for (const s of sel) {
  if (processed >= LIMIT) break;

  const key = (s.orgName + '/' + s.projectName).normalize('NFC');
  const slug = slugMap[key];
  if (!slug) { skipped++; continue; }

  const srcBase = SOURCES[s.source] || SOURCES.T1;
  const projPath = path.join(srcBase, s.orgName, s.projectName);
  const allPdfs = getAllPdfs(projPath);
  if (allPdfs.length === 0) { skipped++; continue; }

  const outDir = path.join(PUBLIC_DIR, slug);

  // 기존 이미지 삭제
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfimg-'));

  try {
    // 모든 PDF에서 이미지 추출
    let allImages = [];
    for (const pdf of allPdfs) {
      const subTmp = path.join(tmpDir, path.basename(pdf, '.pdf'));
      fs.mkdirSync(subTmp, { recursive: true });
      const imgs = extractImages(pdf, subTmp);
      allImages.push(...imgs);
    }

    if (allImages.length === 0) {
      skipped++;
      continue;
    }

    // 썸네일 선택
    const thumb = pickThumbnail(allImages);
    if (thumb) {
      execSync(`sips -Z 1200 "${thumb.path}" --out "${path.join(outDir, 'thumbnail.jpg')}" 2>/dev/null`, { stdio: 'pipe' });
      fs.copyFileSync(path.join(outDir, 'thumbnail.jpg'), path.join(outDir, 'hero.jpg'));
    }

    // 갤러리
    const gallery = pickGallery(allImages, thumb?.name);
    for (let i = 0; i < gallery.length; i++) {
      const num = String(i + 1).padStart(2, '0');
      execSync(`sips -Z 1600 "${gallery[i].path}" --out "${path.join(outDir, num + '-page.jpg')}" 2>/dev/null`, { stdio: 'pipe' });
    }

    const finalCount = fs.readdirSync(outDir).filter(f => f.endsWith('.jpg')).length;
    console.log(`  ✓ ${slug}: ${finalCount} images (from ${allImages.length} extracted)`);
    processed++;

  } catch (err) {
    console.log(`  ✗ ${slug}: ${err.message?.substring(0, 60)}`);
  }

  // tmp 정리
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n✅ 완료: ${processed}개 추출, ${skipped}개 스킵`);

// .md 파일 이미지 참조 업데이트
console.log('\n📝 .md 파일 이미지 참조 업데이트...');
let mdUpdated = 0;

for (const file of fs.readdirSync(CONTENT_DIR).filter(f => f.endsWith('.md'))) {
  const fp = path.join(CONTENT_DIR, file);
  const slug = file.replace('.md', '');
  const imgDir = path.join(PUBLIC_DIR, slug);

  let content = fs.readFileSync(fp, 'utf-8');
  const parts = content.split('---');
  if (parts.length < 3) continue;

  let fm = parts[1];

  if (fs.existsSync(imgDir)) {
    const images = fs.readdirSync(imgDir).filter(f => f.endsWith('.jpg')).sort();
    const hasThumb = images.includes('thumbnail.jpg');
    const gallery = images.filter(f => /^\d{2}-/.test(f));

    if (hasThumb) {
      fm = fm.replace(/^thumbnail:.*$/m, `thumbnail: '/images/projects/${slug}/thumbnail.jpg'`);
      if (fm.includes('heroImage:')) {
        fm = fm.replace(/^heroImage:.*$/m, `heroImage: '/images/projects/${slug}/hero.jpg'`);
      }
    }

    const body = gallery.map(img =>
      `![${slug}](/images/projects/${slug}/${img})`
    ).join('\n\n');

    content = `---${fm}---\n\n${body}\n`;
  } else {
    content = `---${fm}---\n`;
  }

  fs.writeFileSync(fp, content, 'utf-8');
  mdUpdated++;
}

console.log(`✅ ${mdUpdated}개 .md 업데이트`);

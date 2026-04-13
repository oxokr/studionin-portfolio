/**
 * link-images-v2.mjs
 * 실제 존재하는 이미지 파일만 참조하도록 .md 본문을 재생성한다.
 */

import fs from 'fs';
import path from 'path';

const CONTENT_DIR = path.resolve('src/content/projects');
const files = fs.readdirSync(CONTENT_DIR).filter(f => f.endsWith('.md'));
let updated = 0;

for (const file of files) {
  const filePath = path.join(CONTENT_DIR, file);
  const slug = file.replace('.md', '');
  const imgDir = path.join(CONTENT_DIR, slug, 'images');

  let content = fs.readFileSync(filePath, 'utf-8');

  // frontmatter와 body 분리
  const parts = content.split('---');
  if (parts.length < 3) continue;

  const frontmatter = parts[1];

  // 이미지 디렉토리 확인
  if (!fs.existsSync(imgDir)) {
    // 이미지 없으면 body 비우기
    const newContent = `---${frontmatter}---\n`;
    if (newContent !== content) {
      fs.writeFileSync(filePath, newContent, 'utf-8');
      updated++;
    }
    continue;
  }

  const images = fs.readdirSync(imgDir)
    .filter(f => f.endsWith('.jpg') || f.endsWith('.png'))
    .sort();

  const galleryImages = images.filter(f =>
    f !== 'thumbnail.jpg' && f !== 'hero.jpg' && /^\d{2}-/.test(f)
  );

  // thumbnail/heroImage frontmatter 업데이트
  let fm = frontmatter;
  if (images.includes('thumbnail.jpg')) {
    fm = fm.replace(/^thumbnail:.*$/m, `thumbnail: './${slug}/images/thumbnail.jpg'`);
    if (fm.includes('heroImage:')) {
      fm = fm.replace(/^heroImage:.*$/m, `heroImage: './${slug}/images/hero.jpg'`);
    }
  }

  // 갤러리 마크다운 생성 — 실제 존재하는 파일만
  let body = '';
  if (galleryImages.length > 0) {
    body = galleryImages
      .map(img => `![${slug}](./${slug}/images/${img})`)
      .join('\n\n');
  }

  const newContent = `---${fm}---\n\n${body}\n`;
  if (newContent !== content) {
    fs.writeFileSync(filePath, newContent, 'utf-8');
    updated++;
  }
}

console.log(`✅ ${updated}개 .md 파일 업데이트 (실제 이미지 기준)`);

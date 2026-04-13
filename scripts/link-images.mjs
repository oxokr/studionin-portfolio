/**
 * link-images.mjs
 * 추출된 이미지를 .md 파일의 frontmatter에 연결하고
 * 갤러리 마크다운 본문을 자동 생성한다.
 *
 * 사용법: node scripts/link-images.mjs
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

  // 이미지 디렉토리가 없거나 비어있으면 스킵
  if (!fs.existsSync(imgDir)) continue;

  const images = fs.readdirSync(imgDir)
    .filter(f => f.endsWith('.jpg') || f.endsWith('.png'))
    .sort();

  if (images.length === 0) continue;

  const hasThumbnail = images.includes('thumbnail.jpg');
  const hasHero = images.includes('hero.jpg');
  const galleryImages = images.filter(f =>
    f !== 'thumbnail.jpg' && f !== 'hero.jpg' && /^\d{2}-/.test(f)
  );

  if (!hasThumbnail || galleryImages.length === 0) continue;

  let content = fs.readFileSync(filePath, 'utf-8');

  // 이미 이미지가 연결되어 있으면 스킵
  if (content.includes('thumbnail:') && !content.includes("thumbnail: ''")) continue;

  // frontmatter에 thumbnail/heroImage 추가
  content = content.replace(
    /^thumbnail:.*$/m,
    `thumbnail: './${slug}/images/thumbnail.jpg'`
  );
  if (content.includes('heroImage:')) {
    content = content.replace(
      /^heroImage:.*$/m,
      `heroImage: './${slug}/images/hero.jpg'`
    );
  }

  // 빈 thumbnail/heroImage가 없으면 추가
  if (!content.includes('thumbnail:')) {
    content = content.replace(
      /^heroLayout:/m,
      `thumbnail: './${slug}/images/thumbnail.jpg'\nheroImage: './${slug}/images/hero.jpg'\nheroLayout:`
    );
  }

  // 갤러리 마크다운 본문 생성 (---...--- 뒤)
  const parts = content.split('---');
  if (parts.length >= 3) {
    // parts[0] = empty, parts[1] = frontmatter, parts[2+] = body
    const frontmatter = parts[1];
    let body = parts.slice(2).join('---').trim();

    // 기존 바디가 비어있으면 갤러리 생성
    if (!body || body.length < 10) {
      const galleryMd = galleryImages.map((img, i) => {
        if (i % 3 === 2 && galleryImages.length > 4) {
          // 매 3번째는 pair로
          return ''; // pair는 아래에서 처리
        }
        return `![${slug} ${i + 1}](./${slug}/images/${img})`;
      }).filter(Boolean).join('\n\n');

      content = `---${frontmatter}---\n\n${galleryMd}\n`;
    }
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  updated++;
}

console.log(`✅ ${updated}개 .md 파일에 이미지 연결`);

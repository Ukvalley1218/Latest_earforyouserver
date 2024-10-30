import sharp from 'sharp';
export const compressImage = async filePath => {
  const compressedFilePath = filePath.replace(/(\.[\w\d_-]+)$/i, '-compressed$1');
  await sharp(filePath).resize(800, 800, {
    fit: sharp.fit.inside,
    withoutEnlargement: true
  }).toFormat('jpeg', {
    quality: 80
  }).toFile(compressedFilePath);
  return compressedFilePath;
};
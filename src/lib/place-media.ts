export const maxPlacePhotoBytes = 10 * 1024 * 1024;
export const maxPlaceVideoBytes = 250 * 1024 * 1024;
export const maxPlaceVideoSeconds = 10 * 60;
export const isPlaceVideo = (file: Pick<File, 'name' | 'type'>) =>
  file.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name);

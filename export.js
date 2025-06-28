import fs from 'fs';
import path from 'path';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the directory to include in the archive
const directoriesToInclude = ['bots', 'patches', 'profiles', 'services', 'src'];
const filesToInclude = [
  '.gitattributes',
  '.gitignore',
  'andy.json',
  'docker-compose.yml',
  'FAQ.md',
  'keys.json',
  'LICENSE',
  'main.js',
  'package-lock.json',
  'package.json',
  'README.md',
  'settings.js',
  'viewer.html',
];

// Output file
const outputFile = path.join(__dirname, 'project_files.zip');
const output = createWriteStream(outputFile);
const archive = archiver('zip', {
  zlib: { level: 9 },
});

// Log and handle errors
output.on('close', () => {
  console.log(`Archive created successfully. Size: ${archive.pointer()} bytes`);
});
archive.on('error', (err) => {
  throw err;
});

// Start archiving
archive.pipe(output);

// Add directories to the archive
directoriesToInclude.forEach((dir) => {
  const fullPath = path.join(__dirname, dir);
  if (fs.existsSync(fullPath)) {
    archive.directory(fullPath, dir);
  } else {
    console.log(`Directory not found: ${dir}`);
  }
});

// Add individual files to the archive
filesToInclude.forEach((file) => {
  const fullPath = path.join(__dirname, file);
  if (fs.existsSync(fullPath)) {
    archive.file(fullPath, { name: file });
  } else {
    console.log(`File not found: ${file}`);
  }
});

// Finalize the archive
archive.finalize();

import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Ensure 'uploads/' directory exists
const uploadDir = path.resolve('uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

// Accept both 'photo' and 'aadhaarCardPhoto'
const upload = multer({ storage });

const uploadMiddleware = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'aadhaarCardPhoto', maxCount: 1 }
]);

// Attach URLs to req.files[field][0].url
const fileUploadHandler = (req, res, next) => {
  uploadMiddleware(req, res, (err) => {
    if (err) return next(err);
    if (req.files) {
      Object.keys(req.files).forEach((field) => {
        req.files[field][0].url = `/uploads/${req.files[field][0].filename}`;
      });
    }

    // console.log("Files uploaded successfully:", req.files);
    next();
  });
};

export default fileUploadHandler;

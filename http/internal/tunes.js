/* global requireFromRoot, config, Buffer, log */
// Tunes Worker backend
const ALLOWED_IMAGE_TYPES = ["jpg", "png", "gif"];
const ONE_MEGABYTE = 1 * Math.pow(10, 6);
const MAX_IMAGE_SIZE = 5 * ONE_MEGABYTE;
const MAX_FILE_SIZE = 1024 * ONE_MEGABYTE;

let moduleLogger = log.child({ component: "tunes-internal" });
let multer = require("multer");
import SwiftMulterStorage from "~/components/openstack/SwiftMulterStorage";
import convertImage from "~/components/bufferImageConvert";
import resizeImage from "~/components/bufferImageResize";
let sbuff = require("simple-bufferstream");
let getFileType = require("file-type");

let db = requireFromRoot("components/tunes/personalMusicDatabase.js");
let processSong = requireFromRoot("components/tunes/process.js");

let processImageUpload = (req, { stream }, callback) => {
    let logger = moduleLogger.child({ req });
    let targetDimensions = { width: 1024, height: 1024 };
    let chunks = [];
    stream.on("data", (data) => chunks.push(data));
    stream.on("end", () => {
        let buffer = Buffer.concat(chunks);
        let type = getFileType(buffer);
        if (!type) {
            return callback(new Error("Unknown file."));
        }
        if (type.ext && ALLOWED_IMAGE_TYPES.indexOf(type.ext) === -1) {
            return callback(new Error("Invalid file."));
        }
        if (!targetDimensions) {
            logger.info("Converting image to PNG");
            convertImage(buffer, type.ext, (convertError, convertedBuffer) => {
                if (convertError) {
                    logger.error(convertError, "Failed to resize the image");
                    return callback(convertError);
                }
                logger.info("Successfully converted the image")
                return callback(null, sbuff(convertedBuffer));
            });
        } else {
            logger.info("Resizing image and converting it to PNG");
            resizeImage(buffer, type.ext, targetDimensions, (resizeError, resizedBuffer) => {
                if (resizeError) {
                    logger.error(resizeError, "Failed to resize the image");
                    return callback(resizeError);
                }
                logger.info("Successfully resized the image")
                return callback(null, sbuff(resizedBuffer));
            });
        }
    });
};

let uploadImage = multer({
    storage: new SwiftMulterStorage({
        container: config.appImagesUploadContainer,
        processFileFn: processImageUpload,
        defaultExtension: "png",
    }),
    limits: {
        fileSize: MAX_IMAGE_SIZE,
    },
    fileFilter: (req, file, cb) => {
        let splitFileName = file.originalname.split(".");
        let fileExtension = splitFileName[splitFileName.length - 1];
        cb(null, ALLOWED_IMAGE_TYPES.indexOf(fileExtension) !== -1);
    },
});


let upload = multer({
    storage: new SwiftMulterStorage({
        container: config.tunesUploadContainer,
        fileNameFn: (req) => req.query.name,
    }),
    limits: {
        fileSize: MAX_FILE_SIZE,
    },
});

module.exports = function ({ app }) {
    app.get("/tunes/getSongForID/" + config.tunesKey, (req, res, next) => {
        if (!req.query.id) {
            return next(new Error("No ID provided"));
        }
        db.getSongForID(req.query.id, (err, song) => {
            if (err) {
                return next(err);
            }
            if (song === null) {
                return next(new Error("Song not found"));
            }
            res.json(song);
        });
    });


    app.post("/tunes/upload/" + config.tunesKey, upload.single("song"), (req, res) => {
        if (!req.file) {
            throw new Error("Failed to upload the song.");
        }
        res.json({
            link: req.file.link,
            name: req.file.name,
        });
    });

    app.post("/tunes/updateInfo/" + config.tunesKey, (req, res, next) => {
        if (!req.body.username || !req.body._id) {
            throw new Error("Missing parameters");
        }
        db.updateSong(req.body.username, req.body._id, req.body, (err) => {
            if (err) {
                return next(err);
            }
            res.json({ status: "ok" });
        });
    });

    app.delete("/tunes/stopContainer/" + config.tunesKey, (req, res) => {
        if (!req.body.id) {
            throw new Error("Missing parameters");
        }
        processSong.stopContainer(req.body.id);
        res.json({ status: "ok" }); // if we wait for a callback we will send an okay signal to a server that is already dead
    });

    app.post("/tunes/upload-image/" + config.tunesKey, uploadImage.single("image"), (req, res) => {
        if (!req.file) {
            throw new Error("Failed to upload the image.");
        }
        req.log.info({ link: req.file.link }, "Uploaded file");
        res.json({
            link: req.file.link,
            name: req.file.name,
        });
    });

};

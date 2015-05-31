var $ = document.querySelector.bind(document);
function requestFileSystem() {
    return new Promise(function (resolve, reject) {
        if (!window.webkitRequestFileSystem)
            reject();
        window.webkitRequestFileSystem(window.PERSISTENT, 0, resolve, function () { return resolve(false); });
    });
}
function isInstalled() {
    return requestFileSystem().then(function (fs) {
        return new Promise(function (resolve) {
            fs.root.getDirectory('save', {}, function () { return resolve(true); }, function () { return resolve(false); });
        });
    });
}
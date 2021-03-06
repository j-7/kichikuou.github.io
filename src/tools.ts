class ToolsHost {
    private worker: Worker;

    constructor() {
        this.worker = new Worker('js/tools-worker.js');
        this.worker.addEventListener('message', this.onMessage.bind(this));
        this.worker.addEventListener('error', this.onError.bind(this));
    }

    findSaveData() {
        this.worker.postMessage({command:'findSaveData'});
    }

    downloadSaveData() {
        this.worker.postMessage({command:'downloadSaveData'});
    }

    uploadSaveData(files:FileList) {
        this.worker.postMessage({command:'uploadSaveData', files:files});
    }

    private onMessage(evt: MessageEvent) {
        switch (evt.data.command) {
            case 'saveDataFound':
                toolsView.saveDataFound();
                break;
            case 'downloadSaveData':
                toolsView.saveFile(evt.data.blob);
                break;
            case 'uploadSaveData':
                toolsView.uploadSaveDataDone(evt.data.success);
                break;
        }
    }

    private onError(evt: Event) {
        console.log('worker error', evt);
    }
}

class ToolsView {
    constructor() {
        isInstalled().then((installed) => {
            if (installed) {
                show($('.saveDataManager'));
                show($('.config'));
                toolsHost.findSaveData();
            } else {
                show($('.notInstalled'));
            }
        }, () => show($('.unsupported')));

        $('#downloadSaveData').addEventListener('click', this.handleDownloadSaveData.bind(this));
        $('#uploadSaveData').addEventListener('click', this.handleUploadSaveData.bind(this));
        document.body.addEventListener('dragover', dropEffect('none'));
        $('.saveDataManager').addEventListener('dragover', dropEffect('copy'));
        $('.saveDataManager').addEventListener('drop', this.handleDropSaveData.bind(this));
        $('#antialias').addEventListener('change', this.handleAntialiasChange.bind(this));
        if (localStorage.getItem('antialias'))
            (<HTMLInputElement>$('#antialias')).checked = true;
    }

    saveDataFound() {
        $('#downloadSaveData').removeAttribute('disabled');
    }

    saveFile(blob:Blob) {
        var elem = document.createElement('a');
        elem.setAttribute('download', 'savedata.zip');
        elem.setAttribute('href', URL.createObjectURL(blob));
        elem.click();
        ga('send', 'event', 'tools', 'download-savedata');
    }

    uploadSaveDataDone(success:boolean) {
        ga('send', 'event', 'tools', 'restore-savedata', success ? 'ok' : 'fail');
        $('#uploadResult').textContent = success ? '成功しました。' : 'セーブデータを復元できませんでした。';
        if (success)
            this.saveDataFound();
    }

    private handleDownloadSaveData(evt:Event) {
        toolsHost.downloadSaveData();
    }

    private handleUploadSaveData(evt:Event) {
        var input = document.createElement('input');
        input.type = 'file';
        input.addEventListener('change', (evt:Event) => {
            toolsHost.uploadSaveData(input.files);
            document.body.removeChild(input);
        });
        input.style.display = 'none';
        document.body.appendChild(input);
        input.click();
    }

    private handleDropSaveData(evt:DragEvent) {
        evt.stopPropagation();
        evt.preventDefault();
        toolsHost.uploadSaveData(evt.dataTransfer.files);
    }

    private handleAntialiasChange(evt:Event) {
        if ((<HTMLInputElement>evt.target).checked)
            localStorage.setItem('antialias', 'true');
        else
            localStorage.removeItem('antialias');
    }
}

function dropEffect(effect:string) {
    return function(evt:DragEvent) {
        evt.stopPropagation();
        evt.preventDefault();
        evt.dataTransfer.dropEffect = effect;
    }
}

var toolsHost = new ToolsHost();
var toolsView = new ToolsView();

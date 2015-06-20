interface PNaClElement extends HTMLElement {
    lastError: string;
    exitStatus: number;
    postMessage: (message:any)=>void;
}

class XSystem35 {
    private naclModule:PNaClElement;
    private audio:AudioPlayer;
    private naclWidth:number;
    private naclHeight:number;

    constructor() {
        isInstalled().then(this.init.bind(this), () => show($('.unsupported')));

        this.naclModule = <PNaClElement>$('#nacl_module');
        this.naclWidth = Number(this.naclModule.getAttribute('width'));
        this.naclHeight = Number(this.naclModule.getAttribute('height'));
        if (window.location.search.length > 1) {
            for (var pair of window.location.search.substr(1).split('&')) {
                var keyValue = pair.split('=');
                if (keyValue[0] == 'debuglv')
                    this.naclModule.setAttribute('ARG2', keyValue[1]);
            }
        }
    }

    postMessage(message:any) {
        this.naclModule.postMessage(message);
    }

    private init(installed:boolean) {
        if (!installed) {
            show($('.notInstalled'));
            return;
        }
        show($('#contents'));
        document.body.classList.add('bgblack-fade');
        var listener = $('#contents');
        listener.addEventListener('load', this.moduleDidLoad.bind(this), true);
        listener.addEventListener('message', this.handleMessage.bind(this), true);
        listener.addEventListener('error', this.handleError.bind(this), true);
        listener.addEventListener('crash', this.handleCrash.bind(this), true);
        $('#zoom').addEventListener('change', this.handleZoom.bind(this));

        requestFileSystem().then(
            (fs) => this.audio = new AudioPlayer(fs.root.toURL()));
    }

    private moduleDidLoad() {
        this.updateStatus('　');
        this.initZoom();
        setupTouchHandlers(this.naclModule);
    }

    private handleMessage(message:any) {
      var data = message.data;
      if (data.command == 'set_window_size') {
        this.setWindowSize(data.width, data.height);
      } else if (data.command == 'cd_play') {
        this.audio.play(data.track, data.loop);
      } else if (data.command == 'cd_stop') {
        this.audio.stop();
      } else if (data.command == 'cd_getposition') {
        this.reply(data, this.audio.getPosition());
      } else if (typeof data === 'string') {
        console.log(data);  // debug message
      } else {
        console.log('unknown message');
        console.log(message);
      }
    }

    private handleError(event:Event) {
        this.updateStatus('ERROR: ' + this.naclModule.lastError);
    }

    private handleCrash(event:Event) {
        if (this.naclModule.exitStatus == -1)
            this.updateStatus('CRASHED');
        else
            this.updateStatus('EXITED: ' + this.naclModule.exitStatus);
    }

    private handleZoom() {
        var ratio = Number((<HTMLInputElement>$('#zoom')).value) / 100;
        $('#contents').style.width = (640 * ratio) + 'px';
        this.naclModule.setAttribute('width', String(this.naclWidth * ratio));
        this.naclModule.setAttribute('height', String(this.naclHeight * ratio));
        localStorage.setItem('zoom', String(ratio));
    }

    private initZoom() {
        var zoomElement:HTMLInputElement = <HTMLInputElement>$('#zoom');
        show(zoomElement);
        var ratio = Number(localStorage.getItem('zoom') || 1.0);
        if (ratio != 1.0) {
            zoomElement.value = String(ratio * 100);
            this.handleZoom();
        }
    }

    private setWindowSize(width:number, height:number) {
        this.naclWidth = width;
        this.naclHeight = height;
        this.handleZoom();
    }

    private reply(data:any, value:any) {
        var result = { 'result': value,
                       'naclmsg_id': data['naclmsg_id'] };
        this.postMessage({'naclmsg':result});
    }

    private updateStatus(status:string) {
        $('#contents .status').textContent = status;
    }
}

enum TouchState {Up, Down, Left, Right, Tap};

function setupTouchHandlers(element:HTMLElement) {
    var touchState = TouchState.Up;
    var touchTimer:number;

    element.addEventListener('touchstart', onTouchStart);
    element.addEventListener('touchmove', onTouchMove);
    element.addEventListener('touchend', onTouchEnd);

    function onTouchStart(event:TouchEvent) {
        if (event.touches.length != 1)
            return;
        event.preventDefault();
        var touch = event.touches[0];
        generateMouseEvent('mousemove', 0, touch);
        switch (touchState) {
        case TouchState.Tap:
            clearTimeout(touchTimer);
            // fallthrough
        case TouchState.Up:
            touchState = TouchState.Down;
            touchTimer = setTimeout(() => {
                generateMouseEvent('mousedown', 2, touch);
                touchState = TouchState.Right;
            }, 600);
            break;
        }
    }

    function onTouchMove(event:TouchEvent) {
        if (event.touches.length != 1)
            return;
        event.preventDefault();
        var touch = event.touches[0];
        if (touchState === TouchState.Down) {
            clearTimeout(touchTimer);
            generateMouseEvent('mousedown', 0, touch);
            touchState = TouchState.Left;
        }
        generateMouseEvent('mousemove', 0, touch);
    }

    function onTouchEnd(event:TouchEvent) {
        if (event.changedTouches.length != 1)
            return;
        event.preventDefault();
        var touch = event.changedTouches[0];
        switch (touchState) {
        case TouchState.Down:
            clearTimeout(touchTimer);
            generateMouseEvent('mousedown', 0, touch);
            touchState = TouchState.Tap;
            touchTimer = setTimeout(() => {
                generateMouseEvent('mouseup', 0, touch);
                touchState = TouchState.Up;
            }, 20);
            break;
        case TouchState.Left:
            generateMouseEvent('mouseup', 0, touch);
            touchState = TouchState.Up;
            break;
        case TouchState.Right:
            generateMouseEvent('mouseup', 2, touch);
            touchState = TouchState.Up;
            break;
        }
    }

    function generateMouseEvent(type:string, button:number, t:Touch) {
        var mouseEvent = document.createEvent('MouseEvents');
        mouseEvent.initMouseEvent(type, true, true, window, 0,
                                  t.screenX, t.screenY, t.clientX, t.clientY,
                                  false, false, false, false, button, null);
        element.dispatchEvent(mouseEvent);
    }
}

class AudioPlayer {
    private elem:HTMLAudioElement;
    private currentTrack:number;
    private volume:number;
    private muted:boolean;

    constructor(private bgmDir:string) {
        this.volume = Number(localStorage.getItem('volume') || 1);
        this.muted = false;
    }

    play(track:number, loop:number) {
        if (this.elem)
          this.stop();

        var audio = document.createElement('audio');
        audio.setAttribute('src', this.bgmDir + 'track' + track + '.wav');
        audio.setAttribute('controls', 'true');
        audio.volume = this.volume;
        audio.muted = this.muted;
        audio.loop = (loop != 0);
        document.getElementById('contents').appendChild(audio);
        audio.load();
        audio.play();
        this.elem = audio;
        this.currentTrack = track;
    }

    stop() {
        if (this.elem) {
            this.elem.pause();
            this.volume = this.elem.volume;
            this.muted = this.elem.muted;
            this.elem.parentNode.removeChild(this.elem);
            this.elem = null;
            this.currentTrack = 0;
            localStorage.setItem('volume', this.volume + '');
        }
    }

    getPosition(): number {
        if (!this.elem || this.elem.ended)
            return 0;

        var time = Math.round(this.elem.currentTime * 75);
        return this.currentTrack | time << 8;
    }
}

var xsystem35 = new XSystem35;

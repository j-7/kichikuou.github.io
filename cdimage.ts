class ISO9660FileSystem {
    private pvd: PVD;

    constructor(private sectorReader: CDImageReader) {
        this.pvd = new PVD(sectorReader.readSector(0x10));
        if (this.pvd.type != 1)
            throw('PVD not found');
    }

    rootDir(): DirEnt {
        return this.pvd.rootDirEnt();
    }

    getDirEnt(name:string, parent:DirEnt): DirEnt {
        name = name.toLowerCase();
        for (var e of this.readDir(parent)) {
            if (e.name.toLowerCase() == name)
                return e;
        }
        return null;
    }

    readDir(dirent:DirEnt): DirEnt[] {
        var sector = dirent.sector;
        var position = 0;
        var length = dirent.size;
        var entries:DirEnt[] = [];
        while (position < length) {
            if (position == 0)
                var buf = this.sectorReader.readSector(sector);
            var child = new DirEnt(buf, position);
            if (child.length == 0) {
                // Padded end of sector
                position = 2048;
            } else {
                entries.push(child);
                position += child.length;
            }
            if (position > 2048)
                throw('dirent across sector boundary');
            if (position == 2048) {
                sector++;
                position = 0;
                length -= 2048;
            }
        }
        return entries;
    }

    readFile(dirent:DirEnt, callback: (data:ArrayBufferView[]) => void) {
        this.sectorReader.readSequentialSectors(dirent.sector, dirent.size, callback);
    }
}

class PVD {
    private view:DataView;
    constructor(private buf:ArrayBuffer) {
        this.view = new DataView(buf);
    }
    get type(): number {
        return this.view.getUint8(0);
    }
    rootDirEnt(): DirEnt {
        return new DirEnt(this.buf, 156);
    }
}

class DirEnt {
    private view:DataView;
    constructor(private buf:ArrayBuffer, private offset:number) {
        this.view = new DataView(buf, offset);
    }
    get length(): number {
        return this.view.getUint8(0);
    }
    get sector(): number {
        return this.view.getUint32(2, true);
    }
    get size(): number {
        return this.view.getUint32(10, true);
    }
    get name(): string {
        var len = this.view.getUint8(32);
        var decoder = new TextDecoder('shift_jis');
        return decoder.decode(new DataView(this.buf, this.offset+33, len)).split(';')[0];
    }
}

interface CDImageReader {
    readSector(sector:number): ArrayBuffer;
    readSequentialSectors(startSector: number, length: number, callback:(data:ArrayBufferView[])=>void): void;
    maxTrack(): number;
    extractTrack(track:number, dstDir:DirectoryEntrySync): void;
}

class ImageReaderBase {
    constructor(public image:File) {}

    readSequential(startOffset:number,
                   bytesToRead:number,
                   blockSize:number,
                   sectorSize:number,
                   sectorOffset:number,
                   callback:(data:ArrayBufferView[])=>void) {
        var sectors = Math.ceil(bytesToRead / sectorSize);
        var chunk = 256;
        var reader = new FileReaderSync();
        while (sectors > 0) {
            var n = Math.min(chunk, sectors);
            var blob = this.image.slice(startOffset, startOffset + n * blockSize);
            var buf = reader.readAsArrayBuffer(blob);
            var bufs:ArrayBufferView[] = [];
            for (var i = 0; i < n; i++) {
                bufs.push(new DataView(buf, i * blockSize + sectorOffset, Math.min(bytesToRead, sectorSize)));
                bytesToRead -= sectorSize;
            }
            callback(bufs);
            sectors -= n;
            startOffset += n * blockSize;
        }
    }
}

class ImgCueReader extends ImageReaderBase implements CDImageReader {
    private tracks:{ type:string; index:string[]; }[];

    constructor(img:File, cue:File) {
        super(img);
        this.parseCue(cue);
    }

    readSector(sector:number): ArrayBuffer {
        var start = sector * 2352 + 16;
        var end = start + 2048;
        return new FileReaderSync().readAsArrayBuffer(this.image.slice(start, end));
    }

    readSequentialSectors(startSector: number, length: number, callback:(data:ArrayBufferView[])=>void) {
        this.readSequential(startSector * 2352, length, 2352, 2048, 16, callback);
    }

    private parseCue(cueFile:File) {
        var lines = new FileReaderSync().readAsText(cueFile).split('\n');
        this.tracks = [];
        var currentTrack:number = null;
        for (var line of lines) {
            var fields = line.trim().split(/\s+/);
            switch (fields[0]) {
            case 'TRACK':
                currentTrack = Number(fields[1]);
                this.tracks[currentTrack] = {type:fields[2], index:[]};
                break;
            case 'INDEX':
                if (currentTrack)
                    this.tracks[currentTrack].index[Number(fields[1])] = fields[2];
                break;
            }
        }
    }

    maxTrack():number {
        return this.tracks.length - 1;
    }

    extractTrack(track:number, dstDir:DirectoryEntrySync) {
        if (!this.tracks[track] || this.tracks[track].type != 'AUDIO')
            return;

        var startTime = performance.now();
        var start = this.indexToSector(this.tracks[track].index[1]) * 2352;
        var end:number;
        if (this.tracks[track+1]) {
            var index = this.tracks[track+1].index[0] || this.tracks[track+1].index[1];
            end = this.indexToSector(index) * 2352;
        } else {
            end = this.image.size;
        }

        var dstName = 'track' + track + '.wav';
        var dstFile = dstDir.getFile(dstName, {create:true});
        if (dstFile.getMetadata().size - 44 == end - start) {
            console.log(dstName + ': skipped');
            return;
        }
        var writer = dstFile.createWriter();
        writer.truncate(0);
        writer.write(new Blob([createWaveHeader(end - start)]));

        var reader = new FileReaderSync();
        var chunk = 1024*1024;
        while (start < end) {
            var size = Math.min(chunk, end - start);
            try {
                var data = reader.readAsArrayBuffer(this.image.slice(start, start + size));
                writer.write(new Blob([data]));
                start += size;
            } catch (e) {
                if (e.code == DOMException.INVALID_STATE_ERR)
                    postMessage({command:'writeFailed'});
                throw e;
            }
        }
        console.log(dstName, performance.now() - startTime, 'msec');
    }

    private indexToSector(index:string):number {
        var msf = index.split(':').map(Number);
        return msf[0]*60*75 + msf[1]*75 + msf[2];
    }
}

enum MdsTrackMode { Audio = 0xa9, Mode1 = 0xaa };

class MdfMdsReader extends ImageReaderBase implements CDImageReader {
    private tracks:{ mode:number; sectorSize:number; offset:number; sectors:number; }[];

    constructor(mdf:File, mds:File) {
        super(mdf);
        this.parseMds(mds);
    }

    private parseMds(mdsFile:File) {
        var buf = new FileReaderSync().readAsArrayBuffer(mdsFile);

        var signature = new TextDecoder().decode(new DataView(buf, 0, 16));
        if (signature != 'MEDIA DESCRIPTOR')
            throw mdsFile.name + ': not a mds file';

        var header = new DataView(buf, 0, 0x70);
        var entries = header.getUint8(0x62);

        this.tracks = [];
        for (var i = 0; i < entries; i++) {
            var trackData = new DataView(buf, 0x70 + i * 0x50, 0x50);
            var extraData = new DataView(buf, 0x70 + entries * 0x50 + i * 8, 8);
            var mode = trackData.getUint8(0x00);
            var track = trackData.getUint8(0x04);
            var sectorSize = trackData.getUint16(0x10, true);
            var offset = trackData.getUint32(0x28, true); // >4GB offset is not supported.
            var sectors = extraData.getUint32(0x4, true);
            if (track < 100)
                this.tracks[track] = {mode:mode, sectorSize:sectorSize, offset:offset, sectors:sectors};
        }
        if (this.tracks[1].mode != MdsTrackMode.Mode1)
            throw 'track 1 is not mode1';
    }

    readSector(sector:number): ArrayBuffer {
        var start = sector * this.tracks[1].sectorSize + 16;
        var end = start + 2048;
        return new FileReaderSync().readAsArrayBuffer(this.image.slice(start, end));
    }

    readSequentialSectors(startSector: number, length: number, callback:(data:ArrayBufferView[])=>void) {
        var track = this.tracks[1];
        this.readSequential(track.offset + startSector * track.sectorSize, length, track.sectorSize, 2048, 16, callback);
    }

    maxTrack():number {
        return this.tracks.length - 1;
    }

    extractTrack(track:number, dstDir:DirectoryEntrySync) {
        if (!this.tracks[track] || this.tracks[track].mode != MdsTrackMode.Audio)
            return;

        var startTime = performance.now();
        var size = this.tracks[track].sectors * 2352;

        var dstName = 'track' + track + '.wav';
        var dstFile = dstDir.getFile(dstName, {create:true});
        if (dstFile.getMetadata().size - 44 == size) {
            console.log(dstName + ': skipped');
            return;
        }
        var writer = dstFile.createWriter();
        writer.truncate(0);
        writer.write(new Blob([createWaveHeader(size)]));

        this.readSequential(this.tracks[track].offset, size, this.tracks[track].sectorSize, 2352, 0,
            buf => {
                writer.write(new Blob(buf));
            });

        console.log(dstName, performance.now() - startTime, 'msec');
    }
}

function createWaveHeader(size:number):ArrayBuffer {
    var buf = new ArrayBuffer(44);
    var view = new DataView(buf);
    view.setUint32(0, 0x52494646, false); // 'RIFF'
    view.setUint32(4, size + 36, true); // filesize - 8
    view.setUint32(8, 0x57415645, false); // 'WAVE'
    view.setUint32(12, 0x666D7420, false); // 'fmt '
    view.setUint32(16, 16, true); // size of fmt chunk
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 2, true); // stereo
    view.setUint32(24, 44100, true); // sampling rate
    view.setUint32(28, 176400, true); // bytes/sec
    view.setUint16(32, 4, true); // block size
    view.setUint16(34, 16, true); // bit/sample
    view.setUint32(36, 0x64617461, false); // 'data'
    view.setUint32(40, size, true); // data size
    return buf;
}

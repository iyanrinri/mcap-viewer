import { McapIndexedReader } from '@mcap/core';
import type { IReadable } from '@mcap/core';

class FileReadable implements IReadable {
  private file: File;
  private fileReader: FileReader;

  constructor(file: File) {
    this.file = file;
    this.fileReader = new FileReader();
  }

  async size(): Promise<bigint> {
    return BigInt(this.file.size);
  }

  async read(offset: bigint, size: bigint): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const start = Number(offset);
      const end = start + Number(size);
      const slice = this.file.slice(start, end);

      this.fileReader.onload = () => {
        if (this.fileReader.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(this.fileReader.result));
        } else {
          reject(new Error("FileReader result is not ArrayBuffer"));
        }
      };

      this.fileReader.onerror = () => {
        reject(this.fileReader.error);
      };

      this.fileReader.readAsArrayBuffer(slice);
    });
  }
}

export async function parseMcap(file: File) {
  console.log(`Starting to parse MCAP file: ${file.name}`);
  const readable = new FileReadable(file);
  
  try {
    const reader = await McapIndexedReader.Initialize({
      readable,
    });

    if (!reader.chunkIndexes || reader.chunkIndexes.length === 0) {
      console.warn("No chunk indexes found. Is this an indexed MCAP?");
    }

    // We need to iterate over the channels and schemas which might be in the reader's properties.
    // In @mcap/core v2+, channels and schemas are typically accessible directly after Initialize
    // Let's check reader.channelsById and reader.schemasById
    console.log("Channels:", reader.channelsById);
    console.log("Schemas:", reader.schemasById);

    // Let's log schemas clearly for the user
    console.group("MCAP Schemas Found:");
    if (reader.schemasById) {
      for (const [id, schema] of reader.schemasById.entries()) {
        console.log(`Schema ID ${id}: ${schema.name}`);
      }
    }
    console.groupEnd();

    console.group("MCAP Channels Found:");
    if (reader.channelsById) {
      for (const [id, channel] of reader.channelsById.entries()) {
        const schema = reader.schemasById?.get(channel.schemaId);
        console.log(`Channel ${id} [${channel.topic}]: Schema = ${schema?.name || 'Unknown'}, Encoding = ${channel.messageEncoding}`);
      }
    }
    console.groupEnd();

    // Summary 
    console.log("Statistics:", reader.statistics);
    
    let startTime = 0n;
    let endTime = 0n;
    
    if (reader.statistics) {
        startTime = reader.statistics.messageStartTime || 0n;
        endTime = reader.statistics.messageEndTime || 0n;
    }

    return {
      reader,
      channels: reader.channelsById,
      schemas: reader.schemasById,
      startTime,
      endTime
    };

  } catch (err) {
    console.error("Failed to parse MCAP:", err);
    throw err;
  }
}

export interface CompressedVideo {
  format: string;
  data: Uint8Array;
}

// Minimal protobuf reader for foxglove.CompressedVideo
export function parseCompressedVideo(buffer: Uint8Array): CompressedVideo {
  let offset = 0;
  let format = "";
  let data = new Uint8Array();

  function readVarint(): number {
    let result = 0;
    let shift = 0;
    while (offset < buffer.length) {
      const b = buffer[offset++];
      result |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    return result;
  }

  while (offset < buffer.length) {
    const tag = readVarint();
    const wireType = tag & 0x07;
    const fieldNumber = tag >>> 3;

    if (wireType === 0) { // Varint
      readVarint();
    } else if (wireType === 1) { // 64-bit
      offset += 8;
    } else if (wireType === 2) { // Length-delimited
      const length = readVarint();
      if (fieldNumber === 3) {
        // data (bytes)
        data = buffer.slice(offset, offset + length);
      } else if (fieldNumber === 4) {
        // format (string)
        format = new TextDecoder().decode(buffer.slice(offset, offset + length));
      }
      offset += length;
    } else if (wireType === 5) { // 32-bit
      offset += 4;
    } else {
      throw new Error(`Unsupported wire type: ${wireType} at offset ${offset}`);
    }
  }

  return { format, data };
}

package dev.macrofold;

import java.io.*;
import java.nio.charset.StandardCharsets;

/** Shared bounded framing; reconnect and completion policy belong to callers. */
final class SseReader {
  interface Receiver { boolean receive(String data) throws IOException, ApiException; }
  static boolean read(InputStream body, Receiver receive) throws IOException, InterruptedException, ApiException {
    BufferedReader reader = new BufferedReader(new InputStreamReader(body, StandardCharsets.UTF_8));
    StringBuilder line = new StringBuilder(), data = new StringBuilder();
    int character;
    while ((character = reader.read()) != -1) {
      if (Thread.currentThread().isInterrupted()) throw new InterruptedException("Stream detached");
      if (character != '\n') {
        line.append((char) character);
        if (line.length() + data.length() > 4*1024*1024) throw new ApiException(413, "SSE frame exceeds client limit");
        continue;
      }
      if (line.length() > 0 && line.charAt(line.length()-1) == '\r') line.setLength(line.length()-1);
      if (line.length() == 0) {
        if (data.length() > 0 && receive.receive(data.toString())) return true;
        data.setLength(0);
      } else if (line.indexOf("data:") == 0) {
        String value = line.substring(5);
        data.append(value.startsWith(" ") ? value.substring(1) : value).append('\n');
      }
      line.setLength(0);
    }
    return false;
  }
}

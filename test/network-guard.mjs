// Fail integration tests if the CLI or any dependency attempts network access.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
const denied = () => { throw new Error('Network access attempted during an offline CLI test'); };
http.request = http.get = https.request = https.get = denied;
net.connect = net.createConnection = tls.connect = denied;
net.Socket.prototype.connect = denied;
dns.lookup = dns.resolve = dns.promises.lookup = dns.promises.resolve = denied;
dgram.createSocket = denied;
globalThis.fetch = denied;
syncBuiltinESMExports();

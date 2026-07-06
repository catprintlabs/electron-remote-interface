// MTBC USB scale reader — reimplements mtbc-reader using modern node-hid.
// USB HID device: VID 3768, PID 61440.
//
// Byte format from scale:
//   [0] Report ID
//   [1] Status: 1=fault, 2=stable@0, 3=moving, 4=stable, 5=under0, 6=overweight
//   [2] Unit: 3=kg, 11=oz, 12=lb
//   [3] Data scaling (signed, power of 10)
//   [4] Weight LSB
//   [5] Weight MSB

const { EventEmitter } = require('events');

const VID = 3768;
const PID = 61440;
const POLL_MS = 2000;

let HID = null;
try { HID = require('node-hid'); } catch {}

const events = new EventEmitter();
let device = null;
let currentData = [0, 0, 0, 0, 0, 0];
let listening = false;
let pollTimer = null;

function isPluggedIn() {
  if (!HID) return false;
  try {
    return HID.devices().some(d => d.vendorId === VID && d.productId === PID);
  } catch { return false; }
}

function roundToHundredth(n) {
  return parseFloat(n.toFixed(2));
}

function calculateWeightLb(d) {
  let weight = d[3] * d[5] + d[4];
  weight /= 100;
  switch (d[2]) {
    case 3:  weight *= 2.2;    break; // kg → lb
    case 11: weight *= 0.0625; break; // oz → lb
    // 12: already lb
  }
  return roundToHundredth(weight);
}

function getWeightLb() { return calculateWeightLb(currentData); }
function getWeightKg() { return roundToHundredth(getWeightLb() / 2.2); }
function getWeightOz() { return roundToHundredth(getWeightLb() / 0.0625); }
function getStatus()   { return currentData[1]; }

function simulate(weightLb) {
  events.emit('change', roundToHundredth(weightLb));
}

function registerAndListen() {
  if (listening || !isPluggedIn()) return;
  try {
    device = new HID.HID(VID, PID);
    listening = true;

    device.on('error', () => {
      listening = false;
      device = null;
      events.emit('change', 0);
    });

    device.on('data', (data) => {
      if (data[4] === undefined) return;
      const changed = currentData[4] !== data[4];
      currentData = Array.from(data);
      if (changed) events.emit('change', getWeightLb());
    });
  } catch {
    listening = false;
    device = null;
  }
}

function start() {
  registerAndListen();
  pollTimer = setInterval(registerAndListen, POLL_MS);
}

function stop() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (device) { try { device.close(); } catch {} device = null; }
  listening = false;
}

module.exports = { isPluggedIn, getWeightLb, getWeightKg, getWeightOz, getStatus, calculateWeightLb, events, start, stop, simulate };

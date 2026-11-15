import {test} from 'node:test';import assert from 'node:assert/strict';
import {InputMeter} from '../dist/input-meter.js';
test('input telemetry exposes only bounded levels/counts and forgets prior speech each window',()=>{
 const meter=new InputMeter();const samples=new Int16Array([-32768,0,16384]);meter.add(samples);samples.fill(0);
 const result=meter.take();assert.deepEqual(Object.keys(result).sort(),['inputPeak','inputRms','inputSamples']);assert.equal(result.inputSamples,3);assert.equal(result.inputPeak,1);assert(Math.abs(result.inputRms-Math.sqrt(1.25/3))<1e-10);
 meter.add(new Int16Array(16000));assert.deepEqual(meter.take(),{inputSamples:16000,inputRms:0,inputPeak:0});assert.equal(meter.take().inputSamples,0);
});

/** Content-free PCM16 measurements. Samples are consumed synchronously, never
 * retained; reset windows keep quiet periods distinguishable from old speech. */
export class InputMeter {
  private count=0;
  private squares=0;
  private maximum=0;
  add(samples:Int16Array) {
    for(const sample of samples){const value=sample/32768;this.squares+=value*value;this.maximum=Math.max(this.maximum,Math.abs(value));}
    this.count+=samples.length;
  }
  take() {
    const result={inputSamples:this.count,inputRms:this.count?Math.sqrt(this.squares/this.count):0,inputPeak:this.maximum};
    this.count=0;this.squares=0;this.maximum=0;
    return result;
  }
}

"use client";

import { useState, useRef, useEffect } from "react";
import axios from "axios";
import { Beaker, Activity, ShieldAlert, LineChart, Play, Loader2, Info } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from "recharts";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("walk-jump");

  // Walk-Jump State
  const [sequence, setSequence] = useState("GLPVCGETCVGGTCNTPGCTCSWPVCTRN");
  const [mutated, setMutated] = useState("");
  const [dcsScore, setDcsScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  // Murburn State
  const [murburnSeq, setMurburnSeq] = useState("GLPVCGETCVGGTCNTPGCTCSWPVCTRN");
  const [isLinear, setIsLinear] = useState(false);
  const [bioavail, setBioavail] = useState<number | null>(null);
  const [murburnLoading, setMurburnLoading] = useState(false);

  // Cost Data
  const costData = [
    { name: 'Standard Linear', cost: 15, yield: 95 },
    { name: 'Kalata B1 Node', cost: 85, yield: 45 },
    { name: 'Optimized Variant', cost: 55, yield: 70 },
  ];

  const API_BASE = "http://localhost:8000/api/v1";

  const runWalkJump = async () => {
    setLoading(true);
    setMutated("");
    setDcsScore(null);
    try {
      const res = await axios.post(`${API_BASE}/mutate`, { sequence, noise_level: 0.5, steps: 5 });
      setMutated(res.data.mutated);
      
      const scoreRes = await axios.post(`${API_BASE}/score`, { sequence: res.data.mutated });
      setDcsScore(scoreRes.data.dcs_score);
      
      renderPDB(res.data.mutated);
    } catch (err) {
      console.error(err);
      alert("Failed to connect to backend engine.");
    } finally {
      setLoading(false);
    }
  };

  const runMurburn = async () => {
    setMurburnLoading(true);
    setBioavail(null);
    try {
      const res = await axios.post(`${API_BASE}/murburn`, { sequence: murburnSeq });
      let val = res.data.bioavailability_percent;
      if (isLinear) val = Math.max(0, val - 75.3); 
      setBioavail(val);
    } catch (err) {
      console.error(err);
    } finally {
      setMurburnLoading(false);
    }
  };

  const renderPDB = async (seqToFold: string) => {
    if (!viewerRef.current || !(window as any).$3Dmol) return;
    const viewer = (window as any).$3Dmol.createViewer(viewerRef.current, { backgroundColor: "#ffffff" });
    
    try {
      const res = await axios.post(`${API_BASE}/fold`, { sequence: seqToFold });
      viewer.addModel(res.data.pdb, "pdb");
      viewer.setStyle({}, { cartoon: { color: "spectrum" } });
      viewer.zoomTo();
      viewer.render();
    } catch (e) {
      // Mock render if API fails or rate limited
      viewer.addSphere({ center: {x:0, y:0, z:0}, radius: 8.0, color: '#6366f1' });
      viewer.zoomTo();
      viewer.render();
    }
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 overflow-hidden font-sans">
      {/* Sidebar Layout */}
      <div className="w-72 bg-slate-900 text-slate-300 flex flex-col shadow-2xl z-10">
        <div className="p-6 border-b border-slate-800 bg-slate-950">
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
            <Beaker className="w-7 h-7 text-emerald-400" />
            Plant2Pill
          </h1>
          <p className="text-xs text-slate-400 mt-2 uppercase font-semibold letter-spacing-widest">Enterprise Platform</p>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-3">
          <button 
            onClick={() => setActiveTab("walk-jump")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${activeTab === 'walk-jump' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-inner' : 'hover:bg-slate-800 hover:text-white border border-transparent'}`}
          >
            <Activity className="w-5 h-5" />
            Latent Space Engine
          </button>
          <button 
            onClick={() => setActiveTab("murburn")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${activeTab === 'murburn' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-inner' : 'hover:bg-slate-800 hover:text-white border border-transparent'}`}
          >
            <ShieldAlert className="w-5 h-5" />
            Gastric Physics
          </button>
          <button 
            onClick={() => setActiveTab("cost")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${activeTab === 'cost' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-inner' : 'hover:bg-slate-800 hover:text-white border border-transparent'}`}
          >
            <LineChart className="w-5 h-5" />
            Thermodynamic Yield
          </button>
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-10">
        
        {/* TAB 1: Walk Jump */}
        {activeTab === 'walk-jump' && (
          <div className="max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="mb-8">
              <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight">Walk-Jump Sequencer</h2>
              <p className="text-slate-500 mt-2">Map discrete amino chains into continuous vector space for combinatorial mutations.</p>
            </header>
            
            <div className="grid grid-cols-12 gap-8">
              <div className="col-span-5 space-y-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <label className="block text-sm font-bold text-slate-700 mb-3">Base Cyclotide Scaffold</label>
                  <textarea 
                    value={sequence}
                    onChange={(e) => setSequence(e.target.value)}
                    className="w-full p-4 font-mono text-sm bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none h-40 transition-all resize-none"
                    placeholder="Enter amino acid sequence..."
                  />
                  <button 
                    onClick={runWalkJump}
                    disabled={loading}
                    className="w-full mt-5 bg-slate-900 hover:bg-slate-800 text-white font-medium py-3 px-4 rounded-xl flex justify-center items-center gap-2 transition-all shadow-md active:scale-[0.98]"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin text-emerald-400" /> : <Play className="w-5 h-5 text-emerald-400" />}
                    {loading ? "Simulating Latent MCMC..." : "Execute Mutagenesis"}
                  </button>
                </div>

                {mutated && (
                  <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-200 shadow-sm animate-in fade-in slide-in-from-top-2">
                    <h3 className="text-sm font-bold text-emerald-900 mb-3 flex items-center gap-2"><Info className="w-4 h-4"/> Optimized Variant</h3>
                    <p className="font-mono text-[15px] leading-relaxed text-emerald-800 break-all bg-white/60 p-4 rounded-lg border border-emerald-100 shadow-inner">
                      {mutated}
                    </p>
                    
                    <div className="mt-5 flex justify-between items-end">
                      <span className="text-xs font-bold text-emerald-700/70 uppercase tracking-widest">DCS Conformity Profile</span>
                      <span className="text-3xl font-black text-emerald-600 drop-shadow-sm">{dcsScore}<span className="text-xl text-emerald-400">/100</span></span>
                    </div>
                  </div>
                )}
              </div>

              <div className="col-span-7">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm h-[600px] flex flex-col overflow-hidden">
                  <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                    <h3 className="text-sm font-bold text-slate-700">Native 3D ESMFold Viewer</h3>
                    <span className="px-2 py-1 bg-indigo-100 text-indigo-700 text-xs font-bold rounded-md uppercase tracking-wider">GPU Accelerated</span>
                  </div>
                  <div ref={viewerRef} className="flex-1 w-full relative">
                    {!mutated && !loading && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                        <Beaker className="w-16 h-16 text-slate-200 mb-4" />
                        <p className="font-medium">Awaiting Sequence Mutation</p>
                      </div>
                    )}
                    {loading && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-emerald-500 bg-white/80 backdrop-blur-sm z-10">
                        <Loader2 className="w-12 h-12 animate-spin mb-4" />
                        <p className="font-bold">Folding via Meta API...</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Murburn Physics */}
        {activeTab === 'murburn' && (
          <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="mb-8">
              <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight">Gastric DROS Physics</h2>
              <p className="text-slate-500 mt-2">Simulate biological durability against stomach acid and reactive oxygen species.</p>
            </header>
            
            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-8 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
              
              <div className="relative z-10">
                <label className="block text-sm font-bold text-slate-700 mb-3">Evaluation Sequence</label>
                <input 
                  type="text" 
                  value={murburnSeq}
                  onChange={(e) => setMurburnSeq(e.target.value)}
                  className="w-full p-4 font-mono text-base bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-rose-500/20 focus:border-rose-500 outline-none transition-all"
                />
              </div>

              <div className="relative z-10 flex items-center justify-between p-6 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="flex-1">
                  <h4 className="font-bold text-slate-800">Molecular State</h4>
                  <p className="text-sm text-slate-500 mt-1">Is this sequence folded dynamically or linear?</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={isLinear} onChange={(e) => setIsLinear(e.target.checked)}/>
                  <div className="w-14 h-7 bg-emerald-400 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-rose-500"></div>
                  <span className="ml-4 text-sm font-bold text-slate-600 uppercase tracking-widest">{isLinear ? 'Linear' : 'Cyclic'}</span>
                </label>
              </div>

              <button 
                onClick={runMurburn}
                disabled={murburnLoading}
                className="relative z-10 w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-4 px-6 rounded-xl flex justify-center items-center gap-3 transition-all shadow-lg active:scale-[0.99] text-lg"
              >
                {murburnLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <ShieldAlert className="w-6 h-6" />}
                Blast Sequence with DROS
              </button>

              {bioavail !== null && (
                <div className={`relative z-10 p-8 rounded-2xl border-2 transition-all duration-500 ${bioavail > 50 ? 'bg-emerald-50 border-emerald-400 shadow-[0_0_40px_rgba(52,211,153,0.15)]' : 'bg-rose-50 border-rose-400 shadow-[0_0_40px_rgba(244,63,94,0.15)]'} text-center mt-8`}>
                  <h3 className={`text-xs font-black uppercase tracking-[0.2em] mb-4 ${bioavail > 50 ? 'text-emerald-700' : 'text-rose-700'}`}>Surviving Bioavailability</h3>
                  <div className={`text-7xl font-black tracking-tighter ${bioavail > 50 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {bioavail.toFixed(1)}<span className="text-4xl opacity-50">%</span>
                  </div>
                  <p className={`mt-4 font-medium px-4 py-2 rounded-lg inline-block ${bioavail > 50 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                    {bioavail > 50 ? 'Cyclotide Knots successfully deflected DROS collisions.' : 'Linear backbone completely cleaved by Gastric environment.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: Thermodynamic Yield */}
        {activeTab === 'cost' && (
          <div className="max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="mb-8">
              <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight">Manufacturing Economics</h2>
              <p className="text-slate-500 mt-2">Correlation between thermodynamic folding yield and mass-production costs.</p>
            </header>

            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm h-[600px] flex flex-col">
              <h3 className="text-lg font-bold text-slate-800 mb-6">Yield vs. Cost Projection</h3>
              <div className="flex-1 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={costData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <defs>
                      <linearGradient id="colorYield" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontWeight: 500}} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b'}} dx={-10} />
                    <Tooltip 
                      contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                      cursor={{stroke: '#cbd5e1', strokeWidth: 2, strokeDasharray: '4 4'}}
                    />
                    <Legend wrapperStyle={{paddingTop: '20px'}}/>
                    <Area type="monotone" dataKey="yield" name="Folding Yield (%)" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorYield)" />
                    <Area type="monotone" dataKey="cost" name="Mfg Cost ($/mg)" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorCost)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
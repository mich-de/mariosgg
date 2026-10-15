import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;

import java.io.File;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

public class ExportAll extends GhidraScript {
    @Override
    public void run() throws Exception {
        String out = getScriptArgs().length > 0 ? getScriptArgs()[0] : "/tmp/ghidra_export";
        new File(out).mkdirs();
        FunctionManager fm = currentProgram.getFunctionManager();

        PrintWriter tsv = new PrintWriter(new FileWriter(out + "/functions.tsv"));
        tsv.println("addr\tname\tsize\tncallers\tcallees");
        List<Function> fns = new ArrayList<>();
        for (Function f : fm.getFunctions(true)) {
            fns.add(f);
            Set<Function> callees = f.getCalledFunctions(monitor);
            Set<Function> callers = f.getCallingFunctions(monitor);
            StringBuilder sb = new StringBuilder();
            for (Function c : callees) {
                if (sb.length() > 0) sb.append(',');
                sb.append(c.getEntryPoint().toString());
            }
            tsv.println(f.getEntryPoint() + "\t" + f.getName() + "\t" + f.getBody().getNumAddresses() + "\t" + callers.size() + "\t" + sb);
        }
        tsv.close();

        PrintWriter st = new PrintWriter(new FileWriter(out + "/strings.tsv"));
        st.println("addr\tvalue\trefs");
        DataIterator it = currentProgram.getListing().getDefinedData(true);
        while (it.hasNext()) {
            Data d = it.next();
            if (!d.hasStringValue()) continue;
            Object v = d.getValue();
            if (v == null) continue;
            StringBuilder refs = new StringBuilder();
            ReferenceIterator ri = currentProgram.getReferenceManager().getReferencesTo(d.getAddress());
            while (ri.hasNext()) {
                Reference r = ri.next();
                Function cf = fm.getFunctionContaining(r.getFromAddress());
                if (refs.length() > 0) refs.append(',');
                refs.append(r.getFromAddress());
                if (cf != null) refs.append('@').append(cf.getEntryPoint());
            }
            String s = v.toString().replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r");
            st.println(d.getAddress() + "\t" + s + "\t" + refs);
        }
        st.close();

        DecompInterface di = new DecompInterface();
        di.openProgram(currentProgram);
        PrintWriter all = new PrintWriter(new FileWriter(out + "/all.c"));
        int n = 0;
        for (Function f : fns) {
            if (monitor.isCancelled()) break;
            all.println("/* ==== " + f.getEntryPoint() + " " + f.getName() + " size=" + f.getBody().getNumAddresses() + " ==== */");
            try {
                DecompileResults r = di.decompileFunction(f, 120, monitor);
                if (r != null && r.decompileCompleted() && r.getDecompiledFunction() != null) {
                    all.println(r.getDecompiledFunction().getC());
                } else {
                    all.println("/* decompile failed: " + (r == null ? "null" : r.getErrorMessage()) + " */");
                }
            } catch (Exception e) {
                all.println("/* decompile exception: " + e + " */");
            }
            n++;
            if (n % 100 == 0) {
                all.flush();
                println("decompiled " + n + "/" + fns.size());
            }
        }
        all.close();
        println("DONE functions=" + fns.size());
    }
}

# jt.py SEG TABLEOFF COUNT : print a near jump table (index -> target)
import sys, struct
sys.path.insert(0, __import__('os').path.dirname(__file__))
from x86d import mod, lin
seg, off, n = int(sys.argv[1], 16), int(sys.argv[2], 16), int(sys.argv[3])
a = lin(seg, off)
print(" ".join(f"{i}:{struct.unpack_from('<H', mod, a + 2*i)[0]:04x}" for i in range(n)))

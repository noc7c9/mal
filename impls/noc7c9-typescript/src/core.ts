import fs from 'fs';
import type { MalType, MalList, MalVec, MalMap, FnReg } from './types';
import * as t from './types';
import * as reader from './reader';
import * as printer from './printer';

export const ns: Record<string, FnReg> = {
    throw: (arg) => {
        throw arg;
    },

    '+': (a, b) => t.int(t.toInt(a) + t.toInt(b)),
    '-': (a, b) => t.int(t.toInt(a) - t.toInt(b)),
    '*': (a, b) => t.int(t.toInt(a) * t.toInt(b)),
    '/': (a, b) => t.int(Math.floor(t.toInt(a) / t.toInt(b))),

    '=': (a, b) => {
        if (
            (a.type === 'vec' || a.type === 'list') &&
            (b.type === 'vec' || b.type === 'list')
        ) {
            const a_ = a.value;
            const b_ = b.value;
            if (a_.length !== b_.length) return t.bool(false);
            return t.bool(a_.every((_, i) => ns['='](a_[i], b_[i]).value));
        }

        if (a.type === 'map' && b.type === 'map') {
            const a_ = a.value;
            const b_ = b.value;
            const a_keys = Object.keys(a_);
            const b_keys = Object.keys(b_);
            if (a_keys.length !== b_keys.length) return t.bool(false);
            return t.bool(a_keys.every((k) => ns['='](a_[k], b_[k]).value));
        }

        if (a.type !== b.type) return t.bool(false);
        return t.bool(a.value === b.value);
    },

    '>': (a, b) => t.bool(t.toInt(a) > t.toInt(b)),
    '>=': (a, b) => t.bool(t.toInt(a) >= t.toInt(b)),
    '<': (a, b) => t.bool(t.toInt(a) < t.toInt(b)),
    '<=': (a, b) => t.bool(t.toInt(a) <= t.toInt(b)),

    cons: (elem, list) => t.list(elem, ...t.isListOrVec(list).value),
    concat: (...args) => {
        const concatted: MalType[] = [];
        for (let i = 0; i < args.length; i += 1) {
            concatted.push(...t.isListOrVec(args[i]).value);
        }
        return t.list(...concatted);
    },

    list: (...args) => t.list(...args),
    'list?': (arg) => t.bool(arg.type === 'list'),
    'empty?': (arg) => t.bool(t.isListOrVec(arg).value.length === 0),
    count: (arg) => {
        try {
            return t.int(t.isListOrVec(arg).value.length);
        } catch (_) {
            return t.int(0);
        }
    },
    nth: (arg, idx) => {
        const values = t.isListOrVec(arg).value;
        const i = t.toInt(idx);
        if (i >= values.length) {
            throw t.str('nth: index out of range');
        }
        return values[i];
    },
    first: (arg) => {
        if (arg.type === 'nil') return t.nil();
        const values = t.isListOrVec(arg).value;
        if (values.length === 0) return t.nil();
        return values[0];
    },
    rest: (arg) => {
        if (arg.type === 'nil') return t.list();
        return t.list(...t.isListOrVec(arg).value.slice(1));
    },

    apply: (fn, ...args) => {
        args.push(...t.isListOrVec(args.pop()!).value);
        return t.toFnReg(fn)(...args);
    },
    map: (fn, list) => {
        const fn_reg = t.toFnReg(fn);
        return t.list(...t.isListOrVec(list).value.map((arg) => fn_reg(arg)));
    },

    'map?': (arg) => t.bool(arg.type === 'map'),
    'hash-map': (...args) => t.map(args),
    assoc: (map, ...args) => {
        const old_kvs = t.isMap(map).value;
        const new_kvs = t.map(args).value;
        return t.map(Object.assign({}, old_kvs, new_kvs));
    },
    dissoc: (map, ...args) => {
        const clone = { ...t.isMap(map).value };
        for (let i = 0; i < args.length; i += 1) {
            const map_key = t.mal_to_map_key(args[i]);
            delete clone[map_key];
        }
        return t.map(clone);
    },
    get: (map, key) => {
        if (map.type === 'nil') return t.nil();
        return t.isMap(map).value[t.mal_to_map_key(key)] || t.nil();
    },
    'contains?': (map, key) =>
        t.bool(t.mal_to_map_key(key) in t.isMap(map).value),
    keys: (map) =>
        t.list(
            ...Object.keys(t.isMap(map).value).map((k) => t.map_key_to_mal(k)),
        ),
    vals: (map) => t.list(...Object.values(t.isMap(map).value)),

    'sequential?': (arg) => t.bool(arg.type === 'list' || arg.type === 'vec'),

    'vector?': (arg) => t.bool(arg.type === 'vec'),
    vector: (...args) => t.vec(...args),
    vec: (arg) => {
        if (arg.type === 'vec') return arg;
        return t.vec(...t.isList(arg).value);
    },

    symbol: (arg) => t.sym(t.toStr(arg)),
    keyword: (arg) => {
        if (arg.type === 'key') return arg;
        return t.key(':' + t.toStr(arg));
    },

    'nil?': (arg) => t.bool(arg.type === 'nil'),
    'symbol?': (arg) => t.bool(arg.type === 'sym'),
    'keyword?': (arg) => t.bool(arg.type === 'key'),
    'true?': (arg) => t.bool(arg.type === 'bool' && arg.value === true),
    'false?': (arg) => t.bool(arg.type === 'bool' && arg.value === false),

    'read-string': (arg) => reader.read_str(t.toStr(arg)) ?? t.nil(),
    slurp: (arg) => {
        const filepath = t.toStr(arg);
        const content = fs.readFileSync(filepath, 'utf8');
        return t.str(content);
    },

    'pr-str': (...args) =>
        t.str(args.map((a) => printer.print_str(a, true)).join(' ')),
    str: (...args) =>
        t.str(args.map((a) => printer.print_str(a, false)).join('')),
    prn: (...args) => {
        console.log(args.map((a) => printer.print_str(a, true)).join(' '));
        return t.nil();
    },
    println: (...args) => {
        console.log(args.map((a) => printer.print_str(a, false)).join(' '));
        return t.nil();
    },

    atom: (arg) => t.atom(arg),
    'atom?': (arg) => t.bool(arg.type === 'atom'),
    deref: (arg) => t.isAtom(arg).value,
    'reset!': (atom, value) => {
        t.isAtom(atom).value = value;
        return value;
    },
    'swap!': (maybeAtom, maybeFn, ...args) => {
        const atom = t.isAtom(maybeAtom);
        const fn = t.isFn(maybeFn);

        const oldVal = atom.value;
        const newVal = t.toFnReg(fn)(oldVal, ...args);
        atom.value = newVal;
        return newVal;
    },
};

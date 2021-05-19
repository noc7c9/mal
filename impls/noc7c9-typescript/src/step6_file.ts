import type { MalType, MalFn, MalList, MalSym, MalMap } from './types';
import * as t from './types';
import logger from './logger';
import * as readline from './readline';
import * as reader from './reader';
import * as printer from './printer';
import * as envM from './env';
import * as core from './core';

function read(line: string): MalType | null {
    return reader.read_str(line);
}

function eval_ast(ast: MalType, env: envM.Env): MalType {
    switch (ast.type) {
        case 'sym': {
            return env.get(ast);
        }
        case 'list':
        case 'vec':
            return {
                type: ast.type,
                value: ast.value.map((value) => eval_(value, env)),
            };
        case 'map': {
            const value: MalMap['value'] = {};
            Object.entries(ast.value).forEach(([key, val]) => {
                value[key] = eval_(val, env);
            });
            return { type: 'map', value };
        }
        default:
            return ast;
    }
}

function eval_(ast: MalType, env: envM.Env): MalType {
    for (;;) {
        logger('eval_(%s, %s)', ast, env);

        if (ast.type !== 'list') {
            return eval_ast(ast, env);
        }

        if (ast.value.length === 0) {
            return ast;
        }

        switch (ast.value[0].value) {
            case 'def!': {
                logger('def!', ast.value.slice(1));
                const sym = t.isSym(ast.value[1]);
                const value = eval_(ast.value[2], env);
                env.set(sym, value);
                return value;
            }
            case 'let*': {
                logger('let*', ast.value.slice(1));
                const let_env = envM.init(env);
                const bindings = t.isList(ast.value[1]).value;
                for (let i = 0; i < bindings.length; i += 2) {
                    const sym = t.isSym(bindings[i]);
                    const val = eval_(bindings[i + 1], let_env);
                    let_env.set(sym, val);
                }
                // TCO
                ast = ast.value[2];
                env = let_env;
                continue;
            }
            case 'do': {
                logger('do', ast.value.slice(1));
                let result;
                const len = ast.value.length;
                for (let i = 1; i < len - 1; i += 1) {
                    result = eval_(ast.value[i], env);
                }
                // TCO
                ast = ast.value[len - 1];
                continue;
            }
            case 'if': {
                logger('if', ast.value.slice(1));
                const cond = eval_(ast.value[1], env).value;
                if (cond !== false && cond !== null) {
                    // TCO
                    ast = ast.value[2];
                } else if (ast.value[3] == null) {
                    return t.nil();
                } else {
                    // TCO
                    ast = ast.value[3];
                }
                continue;
            }
            case 'fn*': {
                logger('fn*', ast.value.slice(1));
                const params = t.isListOrVec(ast.value[1]);
                ast = ast.value[2];
                return t.fn({
                    type: 'mal',
                    env,
                    params,
                    ast,
                    call: (...args) => {
                        const binds = params.value.map(t.isSym);
                        const fn_env = envM.init(env, binds, args);
                        return eval_(ast, fn_env);
                    },
                    is_macro: false,
                    [logger.custom]: () =>
                        logger.inspect({ params, env: '..elided..', ast }),
                });
            }
            default: {
                const evaled = eval_ast(ast, env) as MalList;
                const fn = t.isFn(evaled.value[0]);
                const args = evaled.value.slice(1);
                const stringfiedArgs = args.map(logger.inspect).join(', ');

                logger('calling %s(%s)', fn.value, stringfiedArgs);

                let result;
                if (fn.value.type === 'native') {
                    result = fn.value.call(...args);
                    logger(
                        'called  %s(%s) => %s',
                        fn.value,
                        stringfiedArgs,
                        result,
                    );
                    return result;
                } else {
                    const binds = t
                        .isListOrVec(fn.value.params)
                        .value.map(t.isSym);
                    // TCO
                    ast = fn.value.ast;
                    env = envM.init(fn.value.env, binds, args);
                    continue;
                }
            }
        }
    }
}

function print(ast: MalType): string {
    return printer.print_str(ast, true);
}

function core_env(): envM.Env {
    const env = envM.init(null);

    Object.entries(core.ns).forEach(([name, fn]) =>
        env.set(t.sym(name), t.fnNative(name, fn)),
    );
    Object.defineProperty(env, logger.custom, { value: () => 'core.ns' });

    eval_(read('(def! not (fn* (a) (if a false true)))')!, env);

    return env;
}

function build_env(): envM.Env {
    const DEBUG_bk = process.env.DEBUG;
    process.env.DEBUG = undefined;

    const env = envM.init(core_env());

    env.set(
        t.sym('eval'),
        t.fnNative('eval', (arg) => eval_(arg, env)),
    );

    const load_file =
        '(def! load-file (fn* (f) (eval (read-string (str "(do " (slurp f) "\nnil)")))))';
    eval_(read(load_file)!, env);

    process.env.DEBUG = DEBUG_bk;

    return env;
}

(async function main() {
    const repl_env = build_env();

    const args = process.argv.slice(2);

    repl_env.set(t.sym('*ARGV*'), t.list(...args.slice(1).map(t.str)));

    if (args.length > 0) {
        const input = `(load-file "${args[0]}")`;
        const read_line = read(input);
        if (read_line == null) process.exit(0);
        const eval_line = eval_(read_line, repl_env);
        print(eval_line);
        process.exit(0);
    }

    const rl = readline.initialize('user> ');
    let line;
    while ((line = await rl())) {
        try {
            line = read(line);
            if (line == null) continue;
            line = eval_(line, repl_env);
            line = print(line);
            console.log(line);
        } catch (err) {
            console.error('Error:', err.message);
        }
    }
})();

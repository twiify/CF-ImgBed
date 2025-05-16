/** @type {import("prettier").Config} */

export default {
    // 每行的长度，默认80
    printWidth: 80,

    // 制表符tab的宽度，默认值是2
    tabWidth: 4,

    // 是否使用tab来代替spaces缩进， 默认false
    useTabs: false,

    // 是否需要分号
    semi: true,

    // 是否使用单引号代替双引号
    singleQuote: true,

    // 对象属性的引号使用
    // as-needed 仅在需要的时候使用
    // consistent 有一个属性需要引号，就都需要引号
    // preserve 保留用户输入的情况
    quoteProps: 'preserve',

    // 在jsx中使用单引号替换双引号
    jsxSingleQuote: false,

    // 行尾逗号,默认es5,可选 none|es5|all
    // none 没有行尾逗号
    // es5 包括es5中的数组、对象
    // all 包括函数对象等所有可选
    trailingComma: 'all',

    // 对象中的空格 默认true
    // true: { foo: bar }
    // false: {foo: bar}
    bracketSpacing: true,

    // JSX标签闭合位置 默认false
    // false: <div
    //          className=""
    //          style=
    //       >
    // true: <div
    //          className=""
    //          style= >
    bracketSameLine: false,

    //箭头函数中的括号
    // “avoid” - 在有需要的时候使用. Example: x => x
    // “always” - 一直使用. Example: (x) => x
    arrowParens: 'always',
    plugins: ['prettier-plugin-astro'],
    overrides: [
        {
            files: '*.astro',
            options: {
                parser: 'astro',
            },
        },
    ],
};

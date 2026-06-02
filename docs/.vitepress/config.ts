import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "NeuroBook",
  description: "NeuroBook：面向长篇小说创作的本地 AI 工作台。",
  srcExclude: [
    'README.md',
    'archived/**',
    'drafts/**',
    'modules/**',
    'operator-bridge.md',
    'research/**',
    'tasks/**'
  ],
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '首页', link: '/' },
      { text: '快速开始', link: '/quick-start' },
      { text: '部署', link: '/deployment' },
      { text: 'Agent', link: '/agent/' },
      { text: 'Profile', link: '/profile/' },
      { text: 'GitHub', link: 'https://github.com/notnotype/neuro-book' }
    ],

    sidebar: [
      {
        text: '开始使用',
        items: [
          { text: '介绍', link: '/introduction' },
          { text: '快速开始', link: '/quick-start' },
          { text: '部署方式', link: '/deployment' }
        ]
      },
      {
        text: 'Agent',
        items: [
          { text: 'Agent 心智模型', link: '/agent/' },
          { text: '工具', link: '/agent/tools' },
          { text: 'Sidecar', link: '/agent/sidecar' }
        ]
      },
      {
        text: 'Profile',
        items: [
          { text: 'Profile 介绍', link: '/profile/' },
          { text: 'Leader', link: '/profile/leader' },
          { text: 'Writer', link: '/profile/writer' },
          { text: '其他 Profile', link: '/profile/other-profiles' }
        ]
      },
      {
        text: 'Profile TSX',
        items: [
          { text: 'Profile TSX 介绍', link: '/profile-tsx/' },
          { text: '节点说明', link: '/profile-tsx/nodes' },
          { text: '示例', link: '/profile-tsx/examples' }
        ]
      },
      {
        text: '高级概念',
        items: [
          { text: 'Agent Harness', link: '/agent/advanced' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/notnotype/neuro-book' }
    ]
  }
})

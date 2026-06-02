# Example Entity State

```yaml
holder: simulation/subjects/player/
condition:
  hiddenProperty: true
subjectVisibleName: 示例物品
subjectVisibleProperties:
  - 看起来只是一个普通物品
```

## GM Notes

这里记录实例真实状态，只给 GM / simulator leader 使用。不要把隐藏状态直接注入 actor；需要展示时由 GM 过滤成 subject-facing observation。

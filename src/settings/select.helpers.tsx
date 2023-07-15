import Fuse from 'fuse.js';
import { TFile } from 'obsidian';
import React from 'react';
import { StylesConfig } from 'react-select';

import { cslList } from './cslList';

export const customSelectStyles: StylesConfig = {
  input: (provided) => {
    return {
      ...provided,
      color: 'var(--text-normal)',
    };
  },
  singleValue: (provided) => {
    return {
      ...provided,
      color: 'var(--text-normal)',
    };
  },
  menu: (provided) => {
    return {
      ...provided,
      backgroundColor: 'var(--background-modifier-form-field)',
      color: 'var(--text-normal)',
    };
  },
  option: (provided, { isFocused, isSelected }) => {
    return {
      ...provided,
      backgroundColor: isFocused
        ? `var(--interactive-accent)`
        : isSelected
        ? `var(--background-modifier-hover)`
        : undefined,
      color: isFocused ? `var(--text-on-accent)` : 'var(--text-normal)',
    };
  },
  control: (provided, state) => {
    return {
      ...provided,
      backgroundColor: 'var(--background-modifier-form-field)',
      color: 'var(--text-normal)',
      borderColor: state.isFocused
        ? 'var(--interactive-accent)'
        : 'var(--background-modifier-border)',
      boxShadow: state.isFocused
        ? '0 0 0 1px var(--interactive-accent)'
        : 'none',
      ':hover': {
        borderColor: state.isFocused
          ? 'var(--interactive-accent)'
          : 'var(--background-modifier-border)',
      },
    };
  },
};

export function searchCSL(inputValue: string) {
  return cslList.search(inputValue).map((res) => res.item);
}

let loadCSLOptionsDB = 0;

export function loadCSLOptions(
  inputValue: string,
  callback: (options: Array<{ value: string; label: string }>) => void
) {
  if (inputValue === '') {
    callback([]);
  } else {
    clearTimeout(loadCSLOptionsDB);
    loadCSLOptionsDB = activeWindow.setTimeout(() => {
      callback([
        { value: inputValue, label: inputValue },
        ...searchCSL(inputValue),
      ]);
    }, 150);
  }
}

export function NoOptionMessage() {
  return <span>Type to search CSL styles</span>;
}

export function NoFileOptionMessage() {
  return <span>Type to search</span>;
}

export function buildFileSearch() {
  const files = app.vault.getMarkdownFiles();
  return new Fuse(files, {
    keys: ['basename'],
    minMatchCharLength: 2,
  });
}

let fileSearchDB = 0;

export const buildLoadFileOptions =
  (search: Fuse<TFile>) =>
  (
    inputValue: string,
    callback: (options: Array<{ value: string; label: string }>) => void
  ) => {
    if (inputValue === '') {
      callback([]);
    } else {
      clearTimeout(fileSearchDB);
      fileSearchDB = activeWindow.setTimeout(() => {
        callback(
          search.search(inputValue).map((res) => {
            return {
              value: res.item.path,
              label: res.item.path,
            };
          })
        );
      }, 150);
    }
  };

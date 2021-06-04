import React from 'react';
import ReactDOM from 'react-dom';
import cloneDeep from 'lodash.clonedeep';
import Select from 'react-select';
import _ from 'underscore';
import DocumentTitle from 'react-document-title';
import SurveyScope from '../models/surveyScope';
import {cascadeMixin} from './cascadeMixin';
import AssetNavigator from './assetNavigator';
import {hashHistory} from 'react-router';
import alertify from 'alertifyjs';
import ProjectSettings from '../components/modalForms/projectSettings';
import MetadataEditor from 'js/components/metadataEditor';
import {
  surveyToValidJson,
  unnullifyTranslations,
  assign,
  koboMatrixParser
} from '../utils';
import {
  ASSET_TYPES,
  AVAILABLE_FORM_STYLES,
  PROJECT_SETTINGS_CONTEXTS,
  update_states,
  NAME_MAX_LENGTH,
  ROUTES,
} from 'js/constants';
import ui from '../ui';
import {bem} from '../bem';
import {stores} from '../stores';
import {actions} from '../actions';
import dkobo_xlform from '../../xlform/src/_xlform.init';
import {dataInterface} from '../dataInterface';
import assetUtils from 'js/assetUtils';
import {renderLoading} from 'js/components/modalForms/modalHelpers';

const ErrorMessage = bem.create('error-message');
const ErrorMessage__strong = bem.create('error-message__header', '<strong>');

const WEBFORM_STYLES_SUPPORT_URL = 'alternative_enketo.html';

const UNSAVED_CHANGES_WARNING = t('You have unsaved changes. Leave form without saving?');

const ASIDE_CACHE_NAME = 'kpi.editable-form.aside';

/**
 * This is a component that displays Form Builder's header and aside. It is also
 * responsible for rendering the survey editor app (all our coffee code). See
 * the `launchAppForSurveyContent` method below for all the magic.
 */

export default assign({
  componentDidMount() {
    this.props.router.setRouteLeaveHook(this.props.route, this.routerWillLeave);

    this.loadAsideSettings();

    if (!this.state.isNewAsset) {
      let uid = this.props.params.assetid || this.props.params.uid;
      stores.allAssets.whenLoaded(uid, (originalAsset) => {
        // Store asset object is mutable and there is no way to predict all the
        // bugs that come from this fact. Form Builder code is already changing
        // the content of the object, so we want to cut all the bugs at the
        // very start of the process.
        const asset = cloneDeep(originalAsset);

        this.setState({asset: asset});

        // HACK switch to setState callback after updating to React 16+
        //
        // This needs to be called at least a single render after the state's
        // asset is being set, because `.form-wrap` node needs to exist for
        // `launchAppForSurveyContent` to work.
        window.setTimeout(() => {
          this.launchAppForSurveyContent(asset.content, {
            name: asset.name,
            settings__style: asset.settings__style,
            asset_uid: asset.uid,
            asset_type: asset.asset_type,
            asset: asset,
          });
        }, 0);
      });
    } else {
      this.launchAppForSurveyContent();
    }

    document.querySelector('.page-wrapper__content').addEventListener('scroll', this.handleScroll);
    this.listenTo(stores.surveyState, this.surveyStateChanged);
  },

  componentWillUnmount () {
    if (this.app && this.app.survey) {
      document.querySelector('.page-wrapper__content').removeEventListener('scroll', this.handleScroll);
      this.app.survey.off('change');
    }
    this.unpreventClosingTab();
  },

  routerWillLeave() {
    if (this.state.preventNavigatingOut) {
      return UNSAVED_CHANGES_WARNING;
    }
  },

  loadAsideSettings() {
    const asideSettings = sessionStorage.getItem(ASIDE_CACHE_NAME);
    if (asideSettings) {
      this.setState(JSON.parse(asideSettings));
    }
  },

  saveAsideSettings(asideSettings) {
    sessionStorage.setItem(ASIDE_CACHE_NAME, JSON.stringify(asideSettings));
  },

  onMetadataEditorChange() {
    this.onSurveyChange();
  },

  onProjectDetailsChange({fieldName, fieldValue}) {
    const settingsNew = this.state.settingsNew || {};
    settingsNew[fieldName] = fieldValue;
    this.setState({
      settingsNew: settingsNew
    });
    this.onSurveyChange();
  },

  surveyStateChanged(state) {
    this.setState(state);
  },

  onStyleChange(evt) {
    let settingsStyle = null;
    if (evt !== null) {
      settingsStyle = evt.value;
    }

    this.setState({
      settings__style: settingsStyle
    });
    this.onSurveyChange();
  },

  getStyleSelectVal(optionVal) {
    return _.find(AVAILABLE_FORM_STYLES, (option) => {
      return option.value === optionVal;
    });
  },

  onSurveyChange: _.debounce(function () {
    if (!this.state.asset_updated !== update_states.UNSAVED_CHANGES) {
      this.preventClosingTab();
    }
    this.setState({
      asset_updated: update_states.UNSAVED_CHANGES,
    });
  }, 200),

  preventClosingTab() {
    this.setState({preventNavigatingOut: true});
    $(window).on('beforeunload.noclosetab', function(){
      return UNSAVED_CHANGES_WARNING;
    });
  },

  unpreventClosingTab() {
    this.setState({preventNavigatingOut: false});
    $(window).off('beforeunload.noclosetab');
  },

  nameChange(evt) {
    this.setState({
      name: assetUtils.removeInvalidChars(evt.target.value),
    });
    this.onSurveyChange();
  },

  groupQuestions() {
    this.app.groupSelectedRows();
  },

  showAll(evt) {
    evt.preventDefault();
    evt.currentTarget.blur();
    this.app.expandMultioptions();
  },

  hasMetadataAndDetails() {
    return this.app && (
      this.state.asset_type === ASSET_TYPES.survey.id ||
      this.state.asset_type === ASSET_TYPES.template.id ||
      this.state.desiredAssetType === ASSET_TYPES.template.id
    );
  },

  needsSave() {
    return this.state.asset_updated === update_states.UNSAVED_CHANGES;
  },

  previewForm(evt) {
    if (evt && evt.preventDefault) {
      evt.preventDefault();
    }

    if (this.state.settings__style !== undefined) {
      this.app.survey.settings.set('style', this.state.settings__style);
    }

    if (this.state.name) {
      this.app.survey.settings.set('title', this.state.name);
    }

    let surveyJSON = surveyToValidJson(this.app.survey);
    if (this.state.asset) {
      surveyJSON = unnullifyTranslations(surveyJSON, this.state.asset.content);
    }
    let params = {source: surveyJSON};

    params = koboMatrixParser(params);

    if (this.state.asset && this.state.asset.url) {
      params.asset = this.state.asset.url;
    }

    dataInterface.createAssetSnapshot(params).done((content) => {
      this.setState({
        enketopreviewOverlay: content.enketopreviewlink,
      });
    }).fail((jqxhr) => {
      let err;
      if (jqxhr && jqxhr.responseJSON && jqxhr.responseJSON.error) {
        err = jqxhr.responseJSON.error;
      } else {
        err = t('Unknown Enketo preview error');
      }
      this.setState({
        enketopreviewError: err,
      });
    });
  },

  saveForm(evt) {
    if (evt && evt.preventDefault) {
      evt.preventDefault();
    }

    if (this.state.settings__style !== undefined) {
      this.app.survey.settings.set('style', this.state.settings__style);
    }

    let surveyJSON = surveyToValidJson(this.app.survey);
    if (this.state.asset) {
      let surveyJSONWithMatrix = koboMatrixParser({source: surveyJSON}).source;
      surveyJSON = unnullifyTranslations(surveyJSONWithMatrix, this.state.asset.content);
    }
    let params = {content: surveyJSON};

    if (this.state.name) {
      params.name = this.state.name;
    }

    // handle settings update (if any changed)
    if (this.state.settingsNew) {
      let settings = {};
      if (this.state.asset) {
        settings = this.state.asset.settings;
      }

      if (this.state.settingsNew.description) {
        settings.description = this.state.settingsNew.description;
      }
      if (this.state.settingsNew.sector) {
        settings.sector = this.state.settingsNew.sector;
      }
      if (this.state.settingsNew.country) {
        settings.country = this.state.settingsNew.country;
      }
      if (this.state.settingsNew['share-metadata']) {
        settings['share-metadata'] = this.state.settingsNew['share-metadata'];
      }
      params.settings = JSON.stringify(settings);
    }

    if (this.state.isNewAsset) {
      // we're intentionally leaving after creating new asset,
      // so there is nothing unsaved here
      this.unpreventClosingTab();

      // create new asset
      if (this.state.desiredAssetType) {
        params.asset_type = this.state.desiredAssetType;
      } else {
        params.asset_type = 'block';
      }
      if (this.state.parentAsset) {
        params.parent = assetUtils.buildAssetUrl(this.state.parentAsset);
      }
      actions.resources.createResource.triggerAsync(params)
        .then(() => {
          hashHistory.push(this.state.backRoute);
        });
    } else {
      // update existing asset
      const uid = this.props.params.assetid || this.props.params.uid;

      actions.resources.updateAsset.triggerAsync(uid, params)
        .then(() => {
          this.unpreventClosingTab();
          this.setState({
            asset_updated: update_states.UP_TO_DATE,
            surveySaveFail: false,
          });
        })
        .catch((resp) => {
          var errorMsg = `${t('Your changes could not be saved, likely because of a lost internet connection.')}&nbsp;${t('Keep this window open and try saving again while using a better connection.')}`;
          if (resp.statusText !== 'error') {
            errorMsg = resp.statusText;
          }

          alertify.defaults.theme.ok = 'ajs-cancel';
          let dialog = alertify.dialog('alert');
          let opts = {
            title: t('Error saving form'),
            message: errorMsg,
            label: t('Dismiss'),
          };
          dialog.set(opts).show();

          this.setState({
            surveySaveFail: true,
            asset_updated: update_states.SAVE_FAILED
          });
        });
    }
    this.setState({
      asset_updated: update_states.PENDING_UPDATE,
    });
  },

  handleScroll(evt) {
    var scrollTop = evt.target.scrollTop;
    if (!this.state.formHeaderFixed && scrollTop > 40) {
      var fhfh = $('.asset-view__row--header').height();
      this.setState({
        formHeaderFixed: true,
        formHeaderFixedHeight: fhfh,
      });
    } else if (this.state.formHeaderFixed && scrollTop <= 32) {
      this.setState({
        formHeaderFixed: false
      });
    }
  },

  buttonStates() {
    var ooo = {};
    if (!this.app) {
      ooo.allButtonsDisabled = true;
    } else {
      ooo.previewDisabled = true;
      if (this.app && this.app.survey) {
        ooo.previewDisabled = this.app.survey.rows.length < 1;
      }
      ooo.groupable = !!this.state.groupButtonIsActive;
      ooo.showAllOpen = !!this.state.multioptionsExpanded;
      ooo.showAllAvailable = (() => {
        var hasSelect = false;
        this.app.survey.forEachRow(function(row){
          if (row._isSelectQuestion()) {
            hasSelect = true;
          }
        });
        return hasSelect;
      })(); // todo: only true if survey has select questions
      ooo.name = this.state.name;
      ooo.hasSettings = this.state.backRoute === ROUTES.FORMS;
      ooo.styleValue = this.state.settings__style;
    }
    if (this.state.isNewAsset) {
      ooo.saveButtonText = t('create');
    } else if (this.state.surveySaveFail) {
      ooo.saveButtonText = `${t('save')} (${t('retry')}) `;
    } else {
      ooo.saveButtonText = t('save');
    }
    return ooo;
  },

  toggleAsideLibrarySearch(evt) {
    evt.target.blur();
    const asideSettings = {
      asideLayoutSettingsVisible: false,
      asideLibrarySearchVisible: !this.state.asideLibrarySearchVisible,
    };
    this.setState(asideSettings);
    this.saveAsideSettings(asideSettings);
  },

  toggleAsideLayoutSettings(evt) {
    evt.target.blur();
    const asideSettings = {
      asideLayoutSettingsVisible: !this.state.asideLayoutSettingsVisible,
      asideLibrarySearchVisible: false
    };
    this.setState(asideSettings);
    this.saveAsideSettings(asideSettings);
  },

  hidePreview() {
    this.setState({
      enketopreviewOverlay: false
    });
  },

  hideCascade() {
    this.setState({
      showCascadePopup: false
    });
  },

  /**
   * The de facto function that is running our Form Builder survey editor app.
   * It builds `dkobo_xlform.view.SurveyApp` using asset data and then appends
   * it to `.form-wrap` node.
   */
  launchAppForSurveyContent(survey, _state = {}) {
    if (_state.name) {
      _state.savedName = _state.name;
    }

    let isEmptySurvey = (
        survey &&
        (survey.settings && Object.keys(survey.settings).length === 0) &&
        survey.survey.length === 0
      );

    try {
      if (!survey) {
        survey = dkobo_xlform.model.Survey.create();
      } else {
        survey = dkobo_xlform.model.Survey.loadDict(survey);
        if (isEmptySurvey) {
          survey.surveyDetails.importDefaults();
        }
      }
    } catch (err) {
      _state.surveyLoadError = err.message;
      _state.surveyAppRendered = false;
    }

    if (!_state.surveyLoadError) {
      _state.surveyAppRendered = true;

      var skp = new SurveyScope({
        survey: survey
      });
      this.app = new dkobo_xlform.view.SurveyApp({
        survey: survey,
        stateStore: stores.surveyState,
        ngScope: skp,
      });
      this.app.$el.appendTo(ReactDOM.findDOMNode(this.refs['form-wrap']));
      this.app.render();
      survey.rows.on('change', this.onSurveyChange);
      survey.rows.on('sort', this.onSurveyChange);
      survey.on('change', this.onSurveyChange);
    }

    this.setState(_state);
  },

  clearPreviewError() {
    this.setState({
      enketopreviewError: false,
    });
  },

  // navigating out of form builder

  safeNavigateToRoute(route) {
    if (!this.needsSave()) {
      hashHistory.push(route);
    } else {
      let dialog = alertify.dialog('confirm');
      let opts = {
        title: UNSAVED_CHANGES_WARNING,
        message: '',
        labels: {ok: t('Yes, leave form'), cancel: t('Cancel')},
        onok: () => {
          hashHistory.push(route);
        },
        oncancel: dialog.destroy
      };
      dialog.set(opts).show();
    }
  },

  safeNavigateToList() {
    if (this.state.backRoute) {
      this.safeNavigateToRoute(this.state.backRoute);
    } else if (this.props.location.pathname.startsWith(ROUTES.LIBRARY)) {
      this.safeNavigateToRoute(ROUTES.LIBRARY);
    } else {
      this.safeNavigateToRoute(ROUTES.FORMS);
    }
  },

  safeNavigateToAsset() {
    let targetRoute = this.state.backRoute;
    if (this.state.backRoute === ROUTES.FORMS) {
      targetRoute = ROUTES.FORM.replace(':uid', this.state.asset_uid);
    } else if (this.state.backRoute === ROUTES.LIBRARY) {
      targetRoute = ROUTES.LIBRARY_ITEM.replace(':uid', this.state.asset_uid);
    }
    this.safeNavigateToRoute(targetRoute);
  },

  // rendering methods

  renderFormBuilderHeader () {
    let {
      previewDisabled,
      groupable,
      showAllOpen,
      showAllAvailable,
      saveButtonText,
    } = this.buttonStates();

    let nameFieldLabel;
    switch (this.state.asset_type) {
      case ASSET_TYPES.template.id:
        nameFieldLabel = ASSET_TYPES.template.label;
        break;
      case ASSET_TYPES.survey.id:
        nameFieldLabel = ASSET_TYPES.survey.label;
        break;
      case ASSET_TYPES.block.id:
        nameFieldLabel = ASSET_TYPES.block.label;
        break;
      case ASSET_TYPES.question.id:
        nameFieldLabel = ASSET_TYPES.question.label;
        break;
      default:
        nameFieldLabel = null;
    }

    if (
      nameFieldLabel === null &&
      this.state.desiredAssetType === ASSET_TYPES.template.id
    ) {
      nameFieldLabel = ASSET_TYPES.template.label;
    }

    return (
      <bem.FormBuilderHeader>
        <bem.FormBuilderHeader__row m='primary'>
          <bem.FormBuilderHeader__cell
            m={'logo'}
            data-tip={t('Return to list')}
            className='left-tooltip'
            tabIndex='0'
            onClick={this.safeNavigateToList}
          >
            <i className='k-icon-kobo' />
          </bem.FormBuilderHeader__cell>

          <bem.FormBuilderHeader__cell m={'name'} >
            <bem.FormModal__item>
              {nameFieldLabel &&
                <label>{nameFieldLabel}</label>
              }
              <input
                type='text'
                maxLength={NAME_MAX_LENGTH}
                onChange={this.nameChange}
                value={this.state.name}
                title={this.state.name}
                id='nameField'
              />
            </bem.FormModal__item>
          </bem.FormBuilderHeader__cell>

          <bem.FormBuilderHeader__cell m={'buttonsTopRight'} >
            <bem.FormBuilderHeader__button
              m={['save', {
                savepending: this.state.asset_updated === update_states.PENDING_UPDATE,
                savefailed: this.state.asset_updated === update_states.SAVE_FAILED,
                saveneeded: this.needsSave(),
              }]}
              onClick={this.saveForm}
              disabled={!this.state.surveyAppRendered || !!this.state.surveyLoadError}
            >
              <i />
              {saveButtonText}
            </bem.FormBuilderHeader__button>

            <bem.FormBuilderHeader__close
              m={[{'close-warning': this.needsSave()}]}
              onClick={this.safeNavigateToAsset}
            >
              <i className='k-icon-close'/>
            </bem.FormBuilderHeader__close>
          </bem.FormBuilderHeader__cell>
        </bem.FormBuilderHeader__row>

        <bem.FormBuilderHeader__row m={'secondary'} >
          <bem.FormBuilderHeader__cell m={'toolsButtons'} >
            <bem.FormBuilderHeader__button
              m={['preview', {previewdisabled: previewDisabled}]}
              onClick={this.previewForm}
              disabled={previewDisabled}
              data-tip={t('Preview form')}
            >
              <i className='k-icon-view' />
            </bem.FormBuilderHeader__button>

            { showAllAvailable &&
              <bem.FormBuilderHeader__button m={['show-all', {
                    open: showAllOpen,
                  }]}
                  onClick={this.showAll}
                  data-tip={t('Expand / collapse questions')}>
                <i className='k-icon-view-all-alt' />
              </bem.FormBuilderHeader__button>
            }

            <bem.FormBuilderHeader__button
              m={['group', {groupable: groupable}]}
              onClick={this.groupQuestions}
              disabled={!groupable}
              data-tip={groupable ? t('Create group with selected questions') : t('Grouping disabled. Please select at least one question.')}
            >
              <i className='k-icon-group' />
            </bem.FormBuilderHeader__button>

            { this.toggleCascade !== undefined &&
              <bem.FormBuilderHeader__button
                m={['cascading']}
                onClick={this.toggleCascade}
                data-tip={t('Insert cascading select')}
              >
                <i className='k-icon-cascading' />
              </bem.FormBuilderHeader__button>
            }
          </bem.FormBuilderHeader__cell>

          <bem.FormBuilderHeader__cell m='verticalRule'/>

          <bem.FormBuilderHeader__cell m='spacer'/>

          <bem.FormBuilderHeader__cell m='verticalRule'/>

          <bem.FormBuilderHeader__cell>
            <bem.FormBuilderHeader__button
              m={['panel-toggle', this.state.asideLibrarySearchVisible ? 'active' : null]}
              onClick={this.toggleAsideLibrarySearch}
            >
              <i className={['k-icon', this.state.asideLibrarySearchVisible ? 'k-icon-close' : 'k-icon-library' ].join(' ')} />
              <span className='panel-toggle-name'>{t('Add from Library')}</span>
            </bem.FormBuilderHeader__button>
          </bem.FormBuilderHeader__cell>

          <bem.FormBuilderHeader__cell m={'verticalRule'} />

          <bem.FormBuilderHeader__cell>
            <bem.FormBuilderHeader__button
              m={['panel-toggle', this.state.asideLayoutSettingsVisible ? 'active' : null]}
              onClick={this.toggleAsideLayoutSettings}
            >
              <i className={['k-icon', this.state.asideLayoutSettingsVisible ? 'k-icon-close' : 'k-icon-settings' ].join(' ')} />
              <span className='panel-toggle-name'>
                {this.hasMetadataAndDetails() &&
                  t('Layout & Settings')
                }
                {!this.hasMetadataAndDetails() &&
                  t('Layout')
                }
              </span>
            </bem.FormBuilderHeader__button>
          </bem.FormBuilderHeader__cell>
        </bem.FormBuilderHeader__row>
      </bem.FormBuilderHeader>
    );
  },

  renderAside() {
    let {
      styleValue,
      hasSettings
    } = this.buttonStates();

    const isAsideVisible = (
      this.state.asideLayoutSettingsVisible ||
      this.state.asideLibrarySearchVisible
    );

    return (
      <bem.FormBuilderAside m={isAsideVisible ? 'visible' : null}>
        { this.state.asideLayoutSettingsVisible &&
          <bem.FormBuilderAside__content>
            <bem.FormBuilderAside__row>
              <bem.FormBuilderAside__header>
                {t('Form style')}

                { stores.serverEnvironment &&
                  stores.serverEnvironment.state.support_url &&
                  <a
                    href={stores.serverEnvironment.state.support_url + WEBFORM_STYLES_SUPPORT_URL}
                    target='_blank'
                    data-tip={t('Read more about form styles')}
                  >
                    <i className='k-icon k-icon-help'/>
                  </a>
                }
              </bem.FormBuilderAside__header>

              <label
                className='kobo-select-label'
                htmlFor='webform-style'
              >
                { hasSettings ?
                  t('Select the form style that you would like to use. This will only affect web forms.')
                  :
                  t('Select the form style. This will only affect the Enketo preview, and it will not be saved with the question or block.')
                }
              </label>

              <Select
                className='kobo-select'
                classNamePrefix='kobo-select'
                id='webform-style'
                name='webform-style'
                ref='webformStyle'
                value={this.getStyleSelectVal(styleValue)}
                onChange={this.onStyleChange}
                placeholder={AVAILABLE_FORM_STYLES[0].label}
                options={AVAILABLE_FORM_STYLES}
                menuPlacement='bottom'
              />
            </bem.FormBuilderAside__row>

            {this.hasMetadataAndDetails() &&
              <bem.FormBuilderAside__row>
                <bem.FormBuilderAside__header>
                  {t('Metadata')}
                </bem.FormBuilderAside__header>

                <MetadataEditor
                  survey={this.app.survey}
                  onChange={this.onMetadataEditorChange}
                  {...this.state}
                />
              </bem.FormBuilderAside__row>
            }

            {this.hasMetadataAndDetails() &&
              <bem.FormBuilderAside__row>
                <bem.FormBuilderAside__header>
                  {t('Details')}
                </bem.FormBuilderAside__header>

                <ProjectSettings
                  context={PROJECT_SETTINGS_CONTEXTS.BUILDER}
                  onProjectDetailsChange={this.onProjectDetailsChange}
                  formAsset={this.state.asset}
                />
              </bem.FormBuilderAside__row>
            }
          </bem.FormBuilderAside__content>
        }
        { this.state.asideLibrarySearchVisible &&
          <bem.FormBuilderAside__content>
            <bem.FormBuilderAside__row>
              <bem.FormBuilderAside__header>
                {t('Search Library')}
              </bem.FormBuilderAside__header>
            </bem.FormBuilderAside__row>

            <bem.FormBuilderAside__row>
              <AssetNavigator/>
            </bem.FormBuilderAside__row>
          </bem.FormBuilderAside__content>
        }
      </bem.FormBuilderAside>
    );
  },

  renderNotLoadedMessage() {
    if (this.state.surveyLoadError) {
      return (
        <ErrorMessage>
          <ErrorMessage__strong>
            {t('Error loading survey:')}
          </ErrorMessage__strong>
          <p>
            {this.state.surveyLoadError}
          </p>
        </ErrorMessage>
      );
    }

    return renderLoading();
  },

  render() {
    var docTitle = this.state.name || t('Untitled');

    if (!this.state.isNewAsset && !this.state.asset) {
      return (
        <DocumentTitle title={`${docTitle} | APPID`}>
          {renderLoading()}
        </DocumentTitle>
      );
    }

    // Only allow user to edit form if they have "Edit Form" permission
    var userCanEditForm = (
      this.state.isNewAsset ||
      assetUtils.isSelfOwned(this.state.asset) ||
      this.userCan('change_asset', this.state.asset)
    );

    return (
      <DocumentTitle title={`${docTitle} | APPID`}>
        <ui.Panel m={['transparent', 'fixed']}>
          {this.renderAside()}

          {userCanEditForm &&
            <bem.FormBuilder>
            {this.renderFormBuilderHeader()}

              <bem.FormBuilder__contents>
                <div ref='form-wrap' className='form-wrap'>
                  {!this.state.surveyAppRendered &&
                    this.renderNotLoadedMessage()
                  }
                </div>
              </bem.FormBuilder__contents>
            </bem.FormBuilder>
          }

          {(!userCanEditForm) &&
            <ui.AccessDeniedMessage/>
          }

          {this.state.enketopreviewOverlay &&
            <ui.Modal
              open
              large
              onClose={this.hidePreview}
              title={t('Form Preview')}
            >
              <ui.Modal.Body>
                <div className='enketo-holder'>
                  <iframe src={this.state.enketopreviewOverlay} />
                </div>
              </ui.Modal.Body>
            </ui.Modal>
          }

          {!this.state.enketopreviewOverlay && this.state.enketopreviewError &&
            <ui.Modal
              open
              error
              onClose={this.clearPreviewError}
              title={t('Error generating preview')}
            >
              <ui.Modal.Body>{this.state.enketopreviewError}</ui.Modal.Body>
            </ui.Modal>
          }

          {this.state.showCascadePopup &&
            <ui.Modal
              open
              onClose={this.hideCascade}
              title={t('Import Cascading Select Questions')}
            >
              <ui.Modal.Body>{this.renderCascadePopup()}</ui.Modal.Body>
            </ui.Modal>
          }
        </ui.Panel>
      </DocumentTitle>
    );
  },
}, cascadeMixin);
